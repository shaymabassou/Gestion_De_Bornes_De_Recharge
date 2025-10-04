import { Certificate } from '../Certificate';
import { CertificateStatus, OCPPGetCertificateIdUseType, OCPPInstallCertificateUseType } from '../ocpp/OCPPServer';
import HttpByIDRequest from './HttpByIDRequest';
import HttpDatabaseRequest from './HttpDatabaseRequest';

// Requête GET pour un certificat spécifique par ID
export interface HttpCertificateGetRequest extends HttpByIDRequest {
  ID: string;
  WithUser: boolean;
}

// Requête DELETE pour un certificat spécifique par ID
export interface HttpCertificateDeleteRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpCertificateAssignRequest extends Certificate {
}

// Requête DELETE pour plusieurs certificats
export interface HttpCertificatesDeleteRequest {
  certificatesIDs: string[];
}

// Requête GET pour une liste de certificats avec filtres et pagination
export interface HttpCertificatesGetRequest extends HttpDatabaseRequest {
  Search?: string;
  CertificateType?: OCPPGetCertificateIdUseType | OCPPInstallCertificateUseType | 'ChargingStationCertificate'|'V2GRootCertificate';
  Status?: CertificateStatus;
  Limit?: number;
  Skip?: number;
  //WithUser?: boolean; // Rendu optionnel car non supporté nativement dans CertificateStorage
}

// Requête pour mettre à jour un certificat
export interface HttpCertificateUpdateRequest extends Certificate {}

export interface HttpCertificatesByIDsUnassignRequest {
  IDs: string[];
  }
  
  export interface HttpCertificateByIDUnassignRequest {
  ID: string;
  }