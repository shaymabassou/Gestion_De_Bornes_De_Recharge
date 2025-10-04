import { DatabaseCount, FilterParams } from '../../types/GlobalType';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';
import global from '../../types/GlobalType';
import { CertificateStatus, OCPPGetCertificateIdUseType, OCPPInstallCertificateUseType } from '../../types/ocpp/OCPPServer';
import Constants from '../../utils/Constants';
import { ServerAction } from '../../types/Server';
import { Certificate } from '../../types/Certificate';
import { HTTPError } from '../../types/HTTPError';
import AppError from '../../exception/AppError';
import * as forge from 'node-forge';
import { X509Certificate } from 'crypto';
import { CertificateService } from '../../server/ocpp/services/CertificateService';

const MODULE_NAME = 'CertificateStorage';

interface CertificateMDB extends Certificate {
  _id: string; 
}

export default class CertificateStorage {
  public static async saveCertificate(tenant: Tenant, certificate: Certificate): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

   // Extraire organization de certificate
  let organization = certificate.organization;
  if (!organization && certificate.certificateChain) {
    try {
      const cleanedChain = certificate.certificateChain.replace(/\\n/g, '\n').trim();
      const certificates = cleanedChain.split('-----END CERTIFICATE-----').filter(cert => cert.trim()).map(cert => cert + '-----END CERTIFICATE-----');
      
      if (certificates.length > 0) {
        
        try {
          const forgeCert = forge.pki.certificateFromPem(certificates[0]);
          const orgAttr = forgeCert.subject.getField('O');
          organization = orgAttr ? orgAttr.value : '-';
          console.log(`Organization extracted with forge: ${organization}`);
          console.log('Subject attributes:', forgeCert.subject.attributes);
        } catch (forgeError) {
          console.warn(`Forge failed to parse certificate: ${forgeError.message}`);
          
          const x509 = new X509Certificate(certificates[0]);
          const subject = x509.subject;
          const orgMatch = subject.match(/O=([^,]+)/);
          organization = orgMatch ? orgMatch[1] : '-';
          console.log(`Organization extracted with crypto fallback: ${organization}`);
        }
      }
    } catch (error) {
      console.error(`Erreur lors de l'extraction de l'organization pour le certificat ${certificate.id}:`, error.message);
       organization = '-'; //  en cas d'erreur générale
    }
  }

    const certificateMDB: CertificateMDB = {
      _id: certificate.id,
      id: certificate.id,
      certificateChain: certificate.certificateChain,
      hashData: certificate.hashData,
      certificateType: certificate.certificateType,
      createdAt: certificate.createdAt,
      expiresAt: certificate.expiresAt,
      status: certificate.status,
      chargingStationID: certificate.chargingStationID,
      tenantID: certificate.tenantID,
      companyID: certificate.companyID,
      organization: organization || '-',
    };

    try {
      await global.database.getCollection<any>(tenant.id, 'certificates').findOneAndUpdate(
        { _id: certificateMDB._id },
        { $set: certificateMDB },
        { upsert: true }
      );

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveCertificate', startTime, certificateMDB);
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'saveCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Failed to save certificate with ID '${certificateMDB._id}' to database`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async getActiveCertificateCount(tenant: Tenant): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const count = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates')
        .countDocuments({ status: CertificateStatus.ACTIVE });

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getActiveCertificateCount', startTime, { count });
      return count;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'getActiveCertificateCount',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to count active certificates',
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async deleteCertificate(tenant: Tenant, certificateID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const result = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates').deleteOne(
        { _id: certificateID }
      );

      if (result.deletedCount === 0) {
        throw new AppError({
          errorCode: HTTPError.OBJECT_DOES_NOT_EXIST_ERROR,
          message: `Certificate with ID '${certificateID}' not found or could not be deleted`,
          module: MODULE_NAME,
          method: 'deleteCertificate',
          action: ServerAction.CERTIFICATE_DELETE
        });
      }

      await Logging.logDebug({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'deleteCertificate',
        action: ServerAction.CERTIFICATE_DELETE,
        message: `Certificate with ID '${certificateID}' successfully deleted`
      });

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteCertificate', startTime, { id: certificateID });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'deleteCertificate',
        action: ServerAction.CERTIFICATE_DELETE,
        message: `Failed to delete certificate with ID '${certificateID}': ${error.message}`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async deleteCertificates(tenant: Tenant, certificateIds: string[]): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const result = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates').deleteMany({
        _id: { $in: certificateIds }
      });

      if (result.deletedCount === 0) {
        throw new AppError({
          errorCode: HTTPError.OBJECT_DOES_NOT_EXIST_ERROR,
          message: `No certificates found for IDs '${certificateIds.join(', ')}'`,
          module: MODULE_NAME,
          method: 'deleteCertificates',
          action: ServerAction.CERTIFICATE_DELETE
        });
      }

      await Logging.logDebug({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'deleteCertificates',
        action: ServerAction.CERTIFICATE_DELETE,
        message: `${result.deletedCount} certificate(s) successfully deleted`
      });

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteCertificates', startTime, { ids: certificateIds });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'deleteCertificates',
        action: ServerAction.CERTIFICATE_DELETE,
        message: `Failed to delete certificates with IDs '${certificateIds.join(', ')}': ${error.message}`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async getCertificate(tenant: Tenant, certificateId: string): Promise<Certificate> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const certificate = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates').findOne(
        { _id: certificateId }
      );

      if (!certificate) {
        throw new AppError({
          errorCode: HTTPError.OBJECT_DOES_NOT_EXIST_ERROR,
          message: `Certificate with ID '${certificateId}' not found`,
          module: MODULE_NAME,
          method: 'getCertificate',
          action: ServerAction.CERTIFICATE
        });
      }

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getCertificate', startTime, { id: certificateId });
      return certificate;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'getCertificate',
        action: ServerAction.CERTIFICATE,
        message: `Failed to retrieve certificate with ID '${certificateId}': ${error.message}`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async getActiveCertificates(tenant: Tenant): Promise<Certificate[]> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const certificates = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates')
        .find({ status: CertificateStatus.ACTIVE })
        .toArray();

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getActiveCertificates', startTime, { count: certificates.length });
      return certificates;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'getActiveCertificates',
        action: ServerAction.CERTIFICATES,
        message: 'Failed to retrieve active certificates',
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  public static async revokeCertificate(tenant: Tenant, certificateId: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const result = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates').updateOne(
        { _id: certificateId },
        { $set: { status: CertificateStatus.REVOKED } }
      );

      if (result.matchedCount === 0) {
        throw new AppError({
          errorCode: HTTPError.OBJECT_DOES_NOT_EXIST_ERROR,
          message: `Certificate with ID '${certificateId}' not found`,
          module: MODULE_NAME,
          method: 'revokeCertificate',
          action: ServerAction.CERTIFICATE
        });
      }

      await Logging.logDebug({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'revokeCertificate',
        action: ServerAction.CERTIFICATE,
        message: `Certificate with ID '${certificateId}' successfully revoked`
      });

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'revokeCertificate', startTime, { id: certificateId });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'revokeCertificate',
        action: ServerAction.CERTIFICATE,
        message: `Failed to revoke certificate with ID '${certificateId}': ${error.message}`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

public static async getCertificateByChain(tenant: Tenant, certificateChain: string): Promise<Certificate | null> {
  const startTime = Logging.traceDatabaseRequestStart();
  DatabaseUtils.checkTenantObject(tenant);

  try {
    // Nettoyer le certificateChain de manière robuste
    let cleanedChain = certificateChain
      .replace(/\\+n/g, '\n') // Remplacer \\n ou \\\\n par \n
      .replace(/\r\n|\r/g, '\n') // Normaliser les sauts de ligne
      .trim();

    // Extraire l'en-tête, le contenu et le footer
    const pemHeader = '-----BEGIN CERTIFICATE-----';
    const pemFooter = '-----END CERTIFICATE-----';
    const headerMatch = cleanedChain.match(/-----[\s]*BEGIN[\s]*CERTIFICATE[\s]*-----/);
    const footerMatch = cleanedChain.match(/-----[\s]*END[\s]*CERTIFICATE[\s]*-----/);

    if (!headerMatch || !footerMatch) {
      await Logging.logWarning({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'getCertificateByChain',
        action: ServerAction.CERTIFICATE,
        message: 'Invalid PEM certificate format: missing header or footer.',
        detailedMessages: { certificateChain },
      });
      return null;
    }

    // Extraire le contenu Base64
    const startIndex = cleanedChain.indexOf(headerMatch[0]) + headerMatch[0].length;
    const endIndex = cleanedChain.indexOf(footerMatch[0]);
    let base64Content = cleanedChain.substring(startIndex, endIndex).trim();

    // Supprimer les espaces et caractères non-Base64
    base64Content = base64Content
      .replace(/\s+/g, '')
      .replace(/[^A-Za-z0-9+/=]/g, '');

    // Reformer le certificat
    cleanedChain = `${pemHeader}\n${base64Content.match(/.{1,64}/g)?.join('\n') || base64Content}\n${pemFooter}`;

    // Log pour déboguer
    await Logging.logDebug({
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'getCertificateByChain',
      action: ServerAction.CERTIFICATE,
      message: `Cleaned certificate chain: ${cleanedChain}`,
    });

    // Extraire le hashData du certificat
    const hashData = CertificateService.extractCertificateHashData(cleanedChain);

    // Rechercher le certificat par issuerNameHash et issuerKeyHash
    const certificate = await global.database
      .getCollection<CertificateMDB>(tenant.id, 'certificates')
      .findOne({
        'hashData.issuerNameHash': hashData.issuerNameHash,
        'hashData.issuerKeyHash': hashData.issuerKeyHash,
        status: CertificateStatus.ACTIVE,
      });

    if (!certificate) {
      await Logging.logDebug({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'getCertificateByChain',
        action: ServerAction.CERTIFICATE,
        message: `No active certificate found for issuerNameHash '${hashData.issuerNameHash}' and issuerKeyHash '${hashData.issuerKeyHash}'`,
      });
      return null;
    }

    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getCertificateByChain', startTime, {
      issuerNameHash: hashData.issuerNameHash,
      issuerKeyHash: hashData.issuerKeyHash,
    });
    return certificate;
  } catch (error) {
    await Logging.logError({
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'getCertificateByChain',
      action: ServerAction.CERTIFICATE,
      message: `Failed to find certificate by chain: ${error.message}`,
      detailedMessages: { error: error instanceof Error ? error.stack : String(error), certificateChain },
    });
    throw error;
  }
}
  public static async getCertificates(tenant: Tenant,
    params: {
      certificateType?: OCPPGetCertificateIdUseType | OCPPInstallCertificateUseType | 'ChargingStationCertificate' | 'V2GRootCertificate';
      status?: CertificateStatus;
      search?: string;
    },
    dbParams: DbParams,
    projectFields?: string[]
  ): Promise<DataResult<Certificate>> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    dbParams = Utils.cloneObject(dbParams);
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);

    const aggregation = [];
    const filters: FilterParams = {};

    if (params.certificateType) {
      filters.certificateType = params.certificateType;
    }

    if (params.status) {
      filters.status = { $regex: new RegExp(`^${params.status}$`, 'i') }; // Insensible à la casse
    }

    if (params.search) {
      filters.$or = [
        { _id: { $regex: params.search, $options: 'i' } },
        { certificateChain: { $regex: params.search, $options: 'i' } }
      ];
    }

    if (!Utils.isEmptyJSon(filters)) {
      aggregation.push({ $match: filters });
    }

    const certificatesCountMDB = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates')
      .aggregate([...aggregation, { $count: 'count' }], DatabaseUtils.buildAggregateOptions())
      .toArray() as DatabaseCount[];

    if (dbParams.onlyRecordCount) {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getCertificates', startTime, aggregation, certificatesCountMDB);
      return {
        count: certificatesCountMDB.length > 0 ? certificatesCountMDB[0].count : 0,
        result: []
      };
    }

    dbParams.sort = dbParams.sort || { createdAt: -1 };
    aggregation.push({ $sort: dbParams.sort });
    aggregation.push({ $skip: dbParams.skip });
    aggregation.push({ $limit: dbParams.limit });

    DatabaseUtils.pushRenameDatabaseID(aggregation);
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    DatabaseUtils.projectFields(aggregation, projectFields);

    const certificatesMDB = await global.database.getCollection<CertificateMDB>(tenant.id, 'certificates')
      .aggregate<CertificateMDB>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray();


    // Enrichir les certificats avec l'Organization
    const enrichedCertificates: Certificate[] = certificatesMDB.map((certMDB) => {
      let organization = '-';
      if (certMDB.certificateChain) {
        try {
          const cleanedChain = certMDB.certificateChain.replace(/\\n/g, '\n').trim();
          const certificates = cleanedChain.split('-----END CERTIFICATE-----')
            .filter(cert => cert.trim())
            .map(cert => cert + '-----END CERTIFICATE-----');
          if (certificates.length > 0) {
            const forgeCert = forge.pki.certificateFromPem(certificates[0]);
            const orgAttr = forgeCert.subject.getField('O');
            organization = orgAttr ? orgAttr.value : '-';
          }
        } catch (error) {
          console.error(`Erreur lors du parsing de certificateChain pour ${certMDB.id}:`, error.message);
        }
      }
      return {
        ...certMDB,
        organization
      };
    });
    console.log('Certificats enrichis:', enrichedCertificates);
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getCertificates', startTime, aggregation, certificatesMDB);
    return {
      count: DatabaseUtils.getCountFromDatabaseCount(certificatesCountMDB[0]),
      result: enrichedCertificates,
      projectFields: projectFields
    };
  }

  public static async findCertificateIdBySerialNumber(
    tenant: Tenant,
    serialNumber: string
  ): Promise<string | null> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const certificate = await global.database
        .getCollection<CertificateMDB>(tenant.id, 'certificates')
        .findOne({ 'hashData.serialNumber': serialNumber });

      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'findCertificateIdBySerialNumber', startTime, { serialNumber });
      return certificate?._id || null;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'findCertificateIdBySerialNumber',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Failed to find certificate by serial number '${serialNumber}': ${error.message}`,
        detailedMessages: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }
}