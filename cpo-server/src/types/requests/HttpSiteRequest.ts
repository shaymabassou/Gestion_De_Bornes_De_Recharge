import HttpDatabaseRequest, { HttpDatabaseProjectRequest } from './HttpDatabaseRequest';

import HttpByIDRequest from './HttpByIDRequest';
import { OpeningTimes } from '../OpeningTimes';
import Company from '../Company';
import SiteArea from '../SiteArea';
import ConnectorStats from '../ConnectorStats';
import Address from '../Address';
import Site from '../Site';

export interface HttpSiteGetRequest extends HttpByIDRequest {
  ID: string;
  WithCompany?: boolean;
}

export interface HttpSiteDeleteRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpSitesGetRequest extends HttpDatabaseRequest {
  Search: string;
  Issuer: boolean;
  WithAvailableChargers: boolean;
  SiteAdmin: boolean;
  WithCompany: boolean;
  UserID: string;
  CompanyID: string;
  SiteID: string;
  ExcludeSitesOfUserID: string;
  LocLongitude?: number;
  LocLatitude?: number;
  LocCoordinates?: number[];
  LocMaxDistanceMeters?: number;
}

export interface HttpSiteCreateUpdateRequest {
  id: string;
  name: string;
  issuer: boolean;
  address: Address;
  companyID: string;
  autoUserSiteAssignment: boolean;
  image?: string;
  connectorStats: ConnectorStats;
  siteAreas?: SiteArea[];
  company?: Company;
  distanceMeters?: number;
  public?: boolean;
  openingTimes?: OpeningTimes;
  tariffID?: string;
  tariffIDs?: string[];
}

export interface HttpSiteImageRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpSiteAssignUsersRequest extends HttpDatabaseProjectRequest {
  siteID: string;
  userIDs: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpSiteUpdateRequest extends Site {
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpSiteCreateRequest extends Site {
}

export interface HttpSiteAdminUpdateRequest {
  userID: string;
  siteID: string;
  siteAdmin: boolean;
}

export interface HttpSiteOwnerUpdateRequest {
  userID: string;
  siteID: string;
  siteOwner: boolean;
}

export interface HttpSiteUsersRequest extends HttpDatabaseRequest {
  Search: string;
  SiteID: string;
}

