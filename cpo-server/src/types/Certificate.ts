import { Action, AuthorizationDefinitionFieldMetadata } from './Authorization';
import { CertificateStatus, OCPPCertificateHashDataType, OCPPGetCertificateIdUseType, OCPPInstallCertificateUseType } from './ocpp/OCPPServer';

export interface Certificate {
  id: string;
  certificateChain: string;
  hashData: OCPPCertificateHashDataType;
  certificateType: OCPPGetCertificateIdUseType | OCPPInstallCertificateUseType | 'ChargingStationCertificate'|'V2GRootCertificate'|'MORootCertificate'|'V2GCertificateChain';
  createdAt: Date;
  expiresAt: Date;
  status: CertificateStatus;
  chargingStationID?: string;
  tenantID: string;
  companyID?: string;
  //issuerOrganization?: string;
  organization?:string;
  //issuerCommonName?:string;
  projectFields?: string[];
  metadata?: Record<string, AuthorizationDefinitionFieldMetadata>;
  canRead?: boolean;
  canDelete?: boolean;
  canUnassign?: boolean;
  canAssign?: boolean;
  canListUsers?: boolean;
  canRevoke?:boolean;
}


export interface ImportedCertificate {
  id: string;
  certificateChain: string;
  hashData: OCPPCertificateHashDataType;
  certificateType: OCPPGetCertificateIdUseType | OCPPInstallCertificateUseType | 'ChargingStationCertificate'|'V2GRootCertificate'|'MORootCertificate'|'V2GCertificateChain';
  createdAt: Date;
  expiresAt: Date;
  status: CertificateStatus;
  chargingStationID?: string;
  tenantID: string;
  companyID?: string;
  siteIDs?: string;
}


export const CertificateRequiredImportProperties = [
  'id'
];