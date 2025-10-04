import ChargingStation, { Voltage } from '../ChargingStation';
import ConnectorStats from '../ConnectorStats';
import Consumption from '../Consumption';
import { OpeningTimes } from '../OpeningTimes';
import Site from '../Site';
import SiteArea, { SiteAreaOcpiData } from '../SiteArea';
import HttpByIDRequest from './HttpByIDRequest';
import HttpDatabaseRequest from './HttpDatabaseRequest';
import Address from '../Address';

export interface HttpSiteAreaGetRequest extends HttpByIDRequest {
  ID: string;
  WithSite?: boolean;
  WithParentSiteArea?: boolean;
  WithChargingStations?: boolean;
}

export interface HttpSiteAreaDeleteRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpSiteAreasGetRequest extends HttpDatabaseRequest {
  Issuer: boolean;
  Search: string;
  SiteID?: string;
  ExcludeSiteAreaID?: string;
  CompanyID?: string;
  WithSite?: boolean;
  WithParentSiteArea?: boolean;
  WithChargingStations?: boolean;
  WithAvailableChargers: boolean;
  LocLongitude?: number;
  LocLatitude?: number;
  LocCoordinates?: number[];
  LocMaxDistanceMeters?: number;
}

export interface HttpSiteAreaConsumptionsGetRequest {
}

export interface HttpSiteAreaCreateUpdateRequest extends HttpSiteAreaConsumptionsRequest {
  id: string;
  name: string;
  issuer: boolean;
  maximumPower: number;
  voltage: Voltage;
  numberOfPhases: number;
  address: Address;
  image: string;
  siteID: string;
  site: Site;
  smartCharging: boolean;
  accessControl: boolean;
  chargingStations: ChargingStation[];
  connectorStats: ConnectorStats;
  values: Consumption[];
  distanceMeters?: number;
  openingTimes?: OpeningTimes;
  tariffID?: string;
  tariffIDs?: string[];
  ocpiData?: SiteAreaOcpiData;
  parentSiteAreaID?: string;
  subSiteAreasAction?: string;
}

export interface HttpSiteAreaConsumptionsRequest {
  SiteAreaID?: string;
  StartDate?: Date;
  EndDate?: Date;
}

export interface HttpAssignChargingStationToSiteAreaRequest {
  siteAreaID: string;
  chargingStationIDs: string[];
}

export interface HttpSiteAreaImageGetRequest extends HttpByIDRequest {
  ID: string;
}

export interface HttpAssignAssetsToSiteAreaRequest {
  siteAreaID: string;
  assetIDs: string[];
}

export interface HttpSiteAreaUpdateRequest extends SiteArea {
  subSiteAreasAction?: string;
}

export interface HttpSiteAreaCreateRequest extends SiteArea {
  subSiteAreasAction?: string;
}
