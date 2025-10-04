import Schema from '../../../../types/validator/Schema';
import SchemaValidator from '../../../../validator/SchemaValidator';
import fs from 'fs';
import global from '../../../../types/GlobalType';
import { HttpCertificateByIDUnassignRequest, HttpCertificateDeleteRequest, HttpCertificateGetRequest, HttpCertificatesByIDsUnassignRequest, HttpCertificatesDeleteRequest, HttpCertificatesGetRequest, HttpCertificateUpdateRequest } from '../../../../types/requests/HttpCertificateRequest';


export default class CertificateValidatorRest extends SchemaValidator {
  private static instance: CertificateValidatorRest | null = null;
  private certificateDelete: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/certificate/certificate-delete.json`, 'utf8'));
  //private certificateUpdate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/certificate/certificate-update.json`, 'utf8'));
  private certificateGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/certificate/certificate-get.json`, 'utf8'));
  private certificatesGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/certificate/certificates-get.json`, 'utf8'));
  private certificatesDelete: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/certificate/certificates-delete.json`, 'utf8'));

  private constructor() {
    super('CertificateValidatorRest');
  }

  public static getInstance(): CertificateValidatorRest {
    if (!CertificateValidatorRest.instance) {
      CertificateValidatorRest.instance = new CertificateValidatorRest();
    }
    return CertificateValidatorRest.instance;
  }

   public validateCertificatesDeleteReq(data: Record<string, unknown>): HttpCertificatesDeleteRequest {
      return this.validate(this.certificatesDelete, data);
    }
    

    public validateCertificateDeleteReq(data: Record<string, unknown>): HttpCertificateDeleteRequest {
        return this.validate(this.certificateDelete, data);
      }

  // public validateCertificateUpdateReq(data: Record<string, unknown>): HttpCertificateUpdateRequest {
  //   return this.validate(this.certificateUpdate, data);
  // }

  public validateCertificateGetReq(data: Record<string, unknown>): HttpCertificateGetRequest {
    return this.validate(this.certificateGet, data);
  }

  public validateCertificatesGetReq(data: Record<string, unknown>): HttpCertificatesGetRequest {
    return this.validate(this.certificatesGet, data);
  }

  // public validateCertificateAssignReq(data: Record<string, unknown>): HttpCertificateAssignRequest {
  //     return this.validate(this.certificateAssign, data);
  //   }

  //  public validateCertificatesByIDsUnassignReq(data: Record<string, unknown>): HttpCertificatesByIDsUnassignRequest {
  //     return this.validate(this.certificatesByIDsUnassign, data);
  //   }
  
    // public validateCertificateByIDUnassignReq(data: Record<string, unknown>): HttpCertificateByIDUnassignRequest {
    //   return this.validate(this.certificateByIDUnassign, data);
    // }
}