import HttpByIDRequest from './HttpByIDRequest';
import HttpDatabaseRequest from './HttpDatabaseRequest';

export interface HttpCompanyGetRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpCompanyDeleteRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpCompaniesGetRequest extends HttpDatabaseRequest {
  Search?: string;
  Issuer?: boolean;
  WithSite?: boolean;
  WithLogo?: boolean;
  WithFavicon?: boolean;
  LocCoordinates?: number[];
  LocLongitude?: number;
  LocLatitude?: number;
  LocMaxDistanceMeters?: number;
}

export interface HttpCompanyLogoGetRequest extends HttpCompanyGetRequest {
  TenantID: string;
}
export interface HttpCompanyFaviconGetRequest extends HttpCompanyGetRequest {
  TenantID: string;
}
