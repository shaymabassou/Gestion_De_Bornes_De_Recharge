import { X509Certificate } from 'crypto';
import { OCPPCertificateHashDataType, OCPPCertificateHashAlgorithmEnumType } from '../../../types/ocpp/OCPPServer';
import Tenant from '../../../types/Tenant';
import Logging from '../../../utils/Logging';
import { ServerAction } from '../../../types/Server';
import * as forge from 'node-forge';
import axios from 'axios';
import Configuration from '../../../utils/Configuration';

const MODULE_NAME = 'CertificateService';

export class CertificateService {
  private static caConfig: { rootCertPem: string; rootKeyPem: string; subCaCertPem?: string; subCaKeyPem?: string } | null = null;

  public static async verifyCertificate(certificateChain: string, hashData?: OCPPCertificateHashDataType): Promise<boolean> {
    try {
      const cleanedChain = certificateChain.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();
      const certificates = cleanedChain.split('-----END CERTIFICATE-----').filter(cert => cert.trim()).map(cert => cert + '-----END CERTIFICATE-----');
      if (certificates.length === 0) {
        throw new Error('Invalid certificate chain');
      }

      const x509 = new X509Certificate(certificates[0]);
      const now = new Date();
      if (new Date(x509.validFrom) > now || new Date(x509.validTo) < now) {
        console.error(`Certificate expired or not yet valid: ${x509.subject}`);
        return false;
      }

      // Vérifier la chaîne complète
      for (let i = 0; i < certificates.length - 1; i++) {
        const cert = forge.pki.certificateFromPem(certificates[i]);
        const issuerCert = forge.pki.certificateFromPem(certificates[i + 1]);
        if (!cert.isIssuer(issuerCert) || !issuerCert.verify(cert)) {
          console.error('Certificate chain verification failed');
          return false;
        }
      }

      if (hashData?.responderURL) {
        const ocspStatus = await this.checkOCSPStatus(hashData);
        if (ocspStatus !== 'good') {
          console.error(`Invalid OCSP status: ${ocspStatus}`);
          return false;
        }
      }

      console.log('Certificate valid');
      return true;
    } catch (error) {
      console.error('Error verifying certificate:', error);
      return false;
    }
  }

  private static async checkOCSPStatus(hashData: OCPPCertificateHashDataType): Promise<'good' | 'revoked' | 'unknown'> {
    try {
      if (!hashData.responderURL || !hashData.serialNumber || !hashData.issuerNameHash || !hashData.issuerKeyHash) {
        throw new Error('Missing required OCSP fields');
      }

      // Vérifier si certificateChain est fourni, sinon on ne peut pas construire la requête correctement
      if (!hashData.certificateChain) {
        console.error('Certificate chain is required for OCSP check');
        return 'unknown';
      }

      const cert = forge.pki.certificateFromPem(hashData.certificateChain);
      const issuerCert = cert.issuerCertificate || cert; // Si pas d'émetteur explicite on assume que c'est auto-signé 

      // Construire manuellement une requête OCSP avec forge
      const ocspRequest = {
        cert: cert,
        issuer: issuerCert,
      };

      const ocspReq = forge.ocsp.requestToDer(ocspRequest); // Convertir en DER
      const base64Request = forge.util.encode64(ocspReq);

      // Envoyer la requête OCSP au responder
      let response;
      try {
        response = await axios.post(
          hashData.responderURL,
          base64Request,
          {
            headers: {
              'Content-Type': 'application/ocsp-request',
              'Accept': 'application/ocsp-response',
            },
            responseType: 'arraybuffer',
            timeout: 30000,
          }
        );
      } catch (networkError) {
        console.error('Network error contacting OCSP responder:', networkError.message);
        return 'unknown';
      }

      // Décoder la réponse OCSP
      const ocspResponse = forge.ocsp.responseFromDer(forge.util.createBuffer(response.data));
      const singleResponse = ocspResponse.getSingleResponse(hashData.serialNumber);

      if (!singleResponse || !singleResponse.certStatus) {
        console.error('No valid certificate status in OCSP response');
        return 'unknown';
      }

      const certStatus = singleResponse.certStatus;
      if (certStatus.type === 'good') {
        return 'good';
      } else if (certStatus.type === 'revoked') {
        return 'revoked';
      } else {
        return 'unknown';
      }
    } catch (error) {
      console.error('Error checking OCSP status:', error.message);
      return 'unknown';
    }
  }

  public static async retrieveOCSPStatus(ocspRequestData: OCPPCertificateHashDataType): Promise<'good' | 'revoked' | 'unknown'> {
    return this.checkOCSPStatus(ocspRequestData);
  }

//generation
  public static extractCertificateHashData(certificateChain: string): OCPPCertificateHashDataType {
    
    const x509 = new X509Certificate(certificateChain.trim());
    const issuer = x509.issuer;
    const publicKeyPem = x509.publicKey.export({ format: 'pem', type: 'spki' });
    const issuerNameHash = forge.md.sha256.create().update(issuer).digest().toHex();
    const issuerKeyHash = forge.md.sha256.create().update(publicKeyPem).digest().toHex();
    return {
      hashAlgorithm: OCPPCertificateHashAlgorithmEnumType.SHA256,
      issuerNameHash,
      issuerKeyHash,
      serialNumber: x509.serialNumber,
      certificateChain,
    
      

    };
  }
//Inscrire un certificat dans gireve basé sur le CSR envoyé
  private static async enrollCertificateWithPNCP(tenant: Tenant, csr: string): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    try {
      const pncpConfig = Configuration.getPncpConfig();
      const response = await axios.post(
        `${pncpConfig.baseUrl}/pncp/1.0.2/PNCCertificate/SimpleEnroll`,
        {
          certificate_profile_id: 'DEFAULT_PROFILE',
          certificate_signing_request: Buffer.from(csr).toString('base64'),
        },
        {
          headers: {
            'Authorization': `Bearer ${pncpConfig.apiKey}`,
            'Content-Type': 'application/json',
            'PNCP-country-code': 'FR',
            'PNCP-from-party-id': 'CPO',
            'X-Correlation-ID': `${tenant.id}-${Date.now()}`,
            'X-Request-ID': `${tenant.id}-${Math.random().toString(36).substring(2)}`,
          },
          timeout: pncpConfig.timeout,
        }
      );

      const { certificate, sub_ca_certificates } = response.data.data;
      if (!certificate || !sub_ca_certificates) {
        throw new Error('Invalid response from PNCP: missing certificate or sub-CA certificates');
      }

      const leafCertPem = `-----BEGIN CERTIFICATE-----\n${certificate}\n-----END CERTIFICATE-----`;
      const subCaCertsPem = sub_ca_certificates.map((cert: string) => 
        `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`
      ).join('');
      const certificateChain = `${leafCertPem}${subCaCertsPem}`;

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'enrollCertificateWithPNCP',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Certificate enrolled successfully via Gireve PNCP',
        detailedMessages: { csr, certificateChain },
      });

      return certificateChain;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'enrollCertificateWithPNCP',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to enroll certificate via Gireve PNCP',
        detailedMessages: { error: error.response?.data || error.message, csr },
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'enrollCertificateWithPNCP', startTime, { csr });
    }
  }

  public static async signCertificate(tenant: Tenant, csr: string, caConfig?: { rootCertPem: string; rootKeyPem: string; subCaCertPem?: string; subCaKeyPem?: string }): Promise<string> {
    // const pncpConfig = Configuration.getPncpConfig();
    // if (pncpConfig.enabled) {
    //   return this.enrollCertificateWithPNCP(tenant, csr);
    // }

    const startTime = Logging.traceDatabaseRequestStart();
    try {
      const forgeCsr = forge.pki.certificationRequestFromPem(csr);
      if (!forgeCsr.verify()) {
        throw new Error('Invalid CSR: signature verification failed');
      }
      //org
      console.log('CSR Subject:', forgeCsr.subject.attributes); 
      const organization = forgeCsr.subject.getField('O')?.value || '-';
      console.log('Extracted Organization:', organization);


      if (!this.caConfig && !caConfig) {
        const rootKeys = forge.pki.rsa.generateKeyPair(2048);
        const rootCert = forge.pki.createCertificate();
        rootCert.publicKey = rootKeys.publicKey;
        rootCert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
        rootCert.validity.notBefore = new Date();
        rootCert.validity.notAfter = new Date(rootCert.validity.notBefore.getTime() + 5 * 365 * 24 * 60 * 60 * 1000);
        rootCert.setSubject([{ name: 'commonName', value: 'CPO_A_Root' }]);
        rootCert.setIssuer(rootCert.subject.attributes);
        rootCert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
        rootCert.sign(rootKeys.privateKey, forge.md.sha256.create());

        const subCaKeys = forge.pki.rsa.generateKeyPair(2048);
        const subCaCert = forge.pki.createCertificate();
        subCaCert.publicKey = subCaKeys.publicKey;
        subCaCert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
        subCaCert.validity.notBefore = new Date();
        subCaCert.validity.notAfter = new Date(subCaCert.validity.notBefore.getTime() + 2 * 365 * 24 * 60 * 60 * 1000);
        subCaCert.setSubject([{ name: 'commonName', value: 'CPO_A_SubCA2' }]);
        subCaCert.setIssuer(rootCert.subject.attributes);
        subCaCert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
        subCaCert.sign(rootKeys.privateKey, forge.md.sha256.create());

        this.caConfig = {
          rootCertPem: forge.pki.certificateToPem(rootCert),
          rootKeyPem: forge.pki.privateKeyToPem(rootKeys.privateKey),
          subCaCertPem: forge.pki.certificateToPem(subCaCert),
          subCaKeyPem: forge.pki.privateKeyToPem(subCaKeys.privateKey),
        };
      }

      const config = caConfig || this.caConfig!;
      const rootCert = forge.pki.certificateFromPem(config.rootCertPem);
      const subCaCert = forge.pki.certificateFromPem(config.subCaCertPem!);
      const subCaKey = forge.pki.privateKeyFromPem(config.subCaKeyPem!);

      const leafCert = forge.pki.createCertificate();
      leafCert.publicKey = forgeCsr.publicKey;
      leafCert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(16));
      leafCert.validity.notBefore = new Date();
      leafCert.validity.notAfter = new Date(leafCert.validity.notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
      leafCert.setSubject(forgeCsr.subject.attributes);
      leafCert.setIssuer(subCaCert.subject.attributes);
      leafCert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
      ]);
      leafCert.sign(subCaKey, forge.md.sha256.create());

      const signedCertificateChain = `${forge.pki.certificateToPem(leafCert)}${forge.pki.certificateToPem(subCaCert)}${forge.pki.certificateToPem(rootCert)}`;

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'signCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'CSR signed successfully',
        detailedMessages: { csr, certificateChain: signedCertificateChain },
      });

      return signedCertificateChain;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'signCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to sign certificate',
        detailedMessages: { error: error.stack, csr },
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'signCertificate', startTime, { csr });
    }
  }



  public static async signCertificateWithGireve(tenant: Tenant,contractCertificateBundle: {
      pcid: string;
      emaid: string;
      dhPublicKey: string;
      contractSignatureEncryptedPrivateKey: string;
      contractSignatureCertChain: {
        certificate: string;
        subCaCertificates: string[];
      };
    },
    provisioningCertificate: {
      provisioningCertificate: {
        certificate: string;
        subCaCertificates: string[];
      };
      pcid: string;
      iso15118Versions: string[];
      v2gRootCaKeyIdentifierList: Array<{
        serialId: string;
        issuerDn: string;
      }>;
    }
  ): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    try {
      // Récupérer la configuration Gireve (à remplacer par les vraies valeurs plus tard)
      const gireveConfig = {
        baseUrl: 'https://api.gireve.com', // Placeholder, à remplacer
        apiKey: 'your-gireve-api-key', // Placeholder, à remplacer
        timeout: 30000, // Timeout par défaut (30s)
      };

      // Construire le corps de la requête
      const requestBody = {
        contract_certificate_bundle: {
          pcid: contractCertificateBundle.pcid,
          emaid: contractCertificateBundle.emaid,
          dh_public_key: contractCertificateBundle.dhPublicKey,
          contract_signature_encrypted_private_key: contractCertificateBundle.contractSignatureEncryptedPrivateKey,
          contract_signature_cert_chain: {
            certificate: Buffer.from(contractCertificateBundle.contractSignatureCertChain.certificate).toString('base64'),
            sub_ca_certificates: contractCertificateBundle.contractSignatureCertChain.subCaCertificates.map(cert =>
              Buffer.from(cert).toString('base64')
            ),
          },
        },
        provisioning_certificate: {
          provisioning_certificate: {
            certificate: Buffer.from(provisioningCertificate.provisioningCertificate.certificate).toString('base64'),
            sub_ca_certificates: provisioningCertificate.provisioningCertificate.subCaCertificates.map(cert =>
              Buffer.from(cert).toString('base64')
            ),
          },
          pcid: provisioningCertificate.pcid,
          iso_15118_versions: provisioningCertificate.iso15118Versions,
          v2g_root_ca_key_identifier_list: provisioningCertificate.v2gRootCaKeyIdentifierList.map(identifier => ({
            serial_id: identifier.serialId,
            issuer_dn: identifier.issuerDn,
          })),
        },
      };

      // Envoyer la requête à Gireve
      const response = await axios.post(
        `${gireveConfig.baseUrl}/pncp/1.0.2/PNCContractCertificate/Bundle/Sign`,
        requestBody,
        {
          headers: {
            'Authorization': `Bearer ${gireveConfig.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'PNCP-from-country-code': 'FR', // À ajuster selon votre configuration
            'PNCP-from-party-id': 'CPO', // À ajuster selon votre rôle
            'X-Correlation-ID': `${tenant.id}-${Date.now()}`,
            'X-Request-ID': `${tenant.id}-${Math.random().toString(36).substring(2)}`,
          },
          timeout: gireveConfig.timeout,
        }
      );

      // Vérifier la réponse
      if (!response.data.data || !Array.isArray(response.data.data) || response.data.data.length === 0) {
        throw new Error('Invalid response from Gireve: missing or empty data array');
      }

      const result = response.data.data[0];
      if (
        !result.contract_certificate_bundle?.contract_signature_cert_chain?.certificate ||
        !result.sa_provisioning_certificate_chain?.certificate
      ) {
        throw new Error('Invalid response from Gireve: missing certificate data');
      }

      // Construire la chaîne de certificats
      const contractCertPem = `-----BEGIN CERTIFICATE-----\n${result.contract_certificate_bundle.contract_signature_cert_chain.certificate}\n-----END CERTIFICATE-----`;
      const contractSubCaCertsPem = result.contract_certificate_bundle.contract_signature_cert_chain.sub_ca_certificates
        .map((cert: string) => `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`)
        .join('');
      const provisioningCertPem = `-----BEGIN CERTIFICATE-----\n${result.sa_provisioning_certificate_chain.certificate}\n-----END CERTIFICATE-----`;
      const provisioningSubCaCertsPem = result.sa_provisioning_certificate_chain.sub_ca_certificates
        .map((cert: string) => `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`)
        .join('');

      const certificateChain = `${contractCertPem}${contractSubCaCertsPem}${provisioningCertPem}${provisioningSubCaCertsPem}`;

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'signCertificateWithGireve',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Certificate signed successfully via Gireve PNCP',
        detailedMessages: { requestBody, certificateChain },
      });

      return certificateChain;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'signCertificateWithGireve',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to sign certificate via Gireve PNCP',
        detailedMessages: { error: error.response?.data || error.message },
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'signCertificateWithGireve', startTime, { contractCertificateBundle });
    }
  }
}