//import { HttpEmspRequest, HttpEmaidAssignRequest, HttpEmaidByVisualIDGetRequest, HttpEmaidByVisualIDUnassignRequest, HttpEmaidCreateRequest, HttpEmaidDeleteRequest, HttpEmaidGetRequest, HttpEmaidUpdateRequest, HttpEmaidsByVisualIDsUnassignRequest, HttpEmaidsDeleteRequest, HttpEmaidsGetRequest } from '../../../../types/requests/HttpEmaidRequest';

import { ImportedEmaid } from '../../../../types/Emaid';
import Schema from '../../../../types/validator/Schema';
import SchemaValidator from '../../../../validator/SchemaValidator';
import fs from 'fs';
import global from '../../../../types/GlobalType';
import { HttpEmaidAssignRequest, HttpEmaidByVisualIDGetRequest, HttpEmaidByVisualIDUnassignRequest, HttpEmaidCreateRequest, HttpEmaidDeleteRequest, HttpEmaidGetRequest, HttpEmaidsByVisualIDsUnassignRequest, HttpEmaidsDeleteRequest, HttpEmaidsGetRequest, HttpEmaidUpdateRequest } from '../../../../types/requests/HttpEmaidRequest';

export default class EmaidValidatorRest extends SchemaValidator {
  private static instance: EmaidValidatorRest | null = null;
  private emaidImportCreate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-import-create.json`, 'utf8'));
  private emaidCreate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-create.json`, 'utf8'));
  private emaidAssign: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-assign.json`, 'utf8'));
  private emaidUpdate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-update.json`, 'utf8'));
  private emaidVisualIDUpdate: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-visual-id-update.json`, 'utf8'));
  private emaidsGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaids-get.json`, 'utf8'));
  //private emspsGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-get-emsp.json`, 'utf8'));
  private emaidGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-get.json`, 'utf8'));
  private emaidDelete: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-delete.json`, 'utf8'));
  private emaidVisualIDGet: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-visual-id-get.json`, 'utf8'));
  private emaidsDelete: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaids-delete.json`, 'utf8'));
  private emaidsByVisualIDsUnassign: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaids-by-visual-ids-unassign.json`, 'utf8'));
  private emaidByVisualIDUnassign: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-by-visual-id-unassign.json`, 'utf8'));
  private emaidProcessPDF: Schema = JSON.parse(fs.readFileSync(`${global.appRoot}/assets/server/rest/v1/schemas/emaid/emaid-process-pdf.json`, 'utf8'));

  private constructor() {
    super('EmaidValidatorRest');
  }

  public static getInstance(): EmaidValidatorRest {
    if (!EmaidValidatorRest.instance) {
      EmaidValidatorRest.instance = new EmaidValidatorRest();
    }
    return EmaidValidatorRest.instance;
  }

  public validateImportedEmaidCreateReq(data: ImportedEmaid): void {
    return this.validate(this.emaidImportCreate, data);
  }

  public validateEmaidCreateReq(data: Record<string, unknown>): HttpEmaidCreateRequest {
    return this.validate(this.emaidCreate, data);
  }

  public validateEmaidAssignReq(data: Record<string, unknown>): HttpEmaidAssignRequest {
    return this.validate(this.emaidAssign, data);
  }

  public validateEmaidUpdateReq(data: Record<string, unknown>): HttpEmaidUpdateRequest {
    return this.validate(this.emaidUpdate, data);
  }

  public validateEmaidVisualIDUpdateReq(data: Record<string, unknown>): HttpEmaidUpdateRequest {
    return this.validate(this.emaidVisualIDUpdate, data);
  }

  public validateEmaidsGetReq(data: Record<string, unknown>): HttpEmaidsGetRequest {
    return this.validate(this.emaidsGet, data);
  }

//   public validateGetEmsps(data: Record<string, unknown>): HttpEmspRequest {
//     return this.validate(this.emspsGet, data);
//   }

  public validateEmaidGetReq(data: Record<string, unknown>): HttpEmaidGetRequest {
    return this.validate(this.emaidGet, data);
  }

  public validateEmaidByVisualIDGetReq(data: Record<string, unknown>): HttpEmaidByVisualIDGetRequest {
    return this.validate(this.emaidVisualIDGet, data);
  }

  public validateEmaidsDeleteReq(data: Record<string, unknown>): HttpEmaidsDeleteRequest {
    return this.validate(this.emaidsDelete, data);
  }

  public validateEmaidDeleteReq(data: Record<string, unknown>): HttpEmaidDeleteRequest {
    return this.validate(this.emaidDelete, data);
  }

  public validateEmaidsByVisualIDsUnassignReq(data: Record<string, unknown>): HttpEmaidsByVisualIDsUnassignRequest {
    return this.validate(this.emaidsByVisualIDsUnassign, data);
  }

  public validateEmaidByVisualIDUnassignReq(data: Record<string, unknown>): HttpEmaidByVisualIDUnassignRequest {
    return this.validate(this.emaidByVisualIDUnassign, data);
  }

  public validateEmaidProcessPDFReq(data: Record<string, unknown>): Record<string, unknown> {
    return this.validate(this.emaidProcessPDF, data);
  }

}