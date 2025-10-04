import Address from './Address';
import CreatedUpdatedProps from './CreatedUpdatedProps';

export default interface Tenant extends CreatedUpdatedProps {
  id: string;
  name: string;
  email: string;
  subdomain: string;
  type: null | 'Normal' | 'Parent' | 'Child';
  parentID: string;
  primaryColor: string;
  secondaryColor: string;
  address: Address;
  logo: string;
  favicon: string;
  components: TenantComponent;
  redirectDomain?: string;
  idleMode?: boolean // Prevents batch and async tasks executions when moving the tenant to a different cloud infrastructure provider
  taskExecutionEnv?: string; // Environement on which tasks should be executed
}

export interface TenantComponent {
  ocpi?: TenantComponentContent;
  oicp?: TenantComponentContent;
  organization?: TenantComponentContent;
  pricing?: TenantComponentContent;
  billing?: TenantComponentContent;
  billingPlatform?: TenantComponentContent;
  refund?: TenantComponentContent;
  statistics?: TenantComponentContent;
  analytics?: TenantComponentContent;
  smartCharging?: TenantComponentContent;
  asset?: TenantComponentContent;
  car?: TenantComponentContent;
  carConnector?: TenantComponentContent;
  doubleAccess?: TenantComponentContent;
  multipleTarifs?: TenantComponentContent;
  borneVIP?: TenantComponentContent;
  dataGouvStaticData?: TenantComponentContent;
  dataGouvDynamiccData?: TenantComponentContent;

}

export interface TenantComponentContent {
  active: boolean;
  type: string;
}

export interface TenantLogo {
  id: string;
  logo: string;
}

export interface TenantFavicon {
  id: string;
  favicon: string;
}

export enum TenantComponents {
  OCPI = 'ocpi',
  OICP = 'oicp',
  REFUND = 'refund',
  PRICING = 'pricing',
  ORGANIZATION = 'organization',
  STATISTICS = 'statistics',
  ANALYTICS = 'analytics',
  BILLING = 'billing',
  BILLING_PLATFORM = 'billingPlatform',
  ASSET = 'asset',
  SMART_CHARGING = 'smartCharging',
  CAR = 'car',
  CAR_CONNECTOR = 'carConnector',
  DOUBLE_ACCESS = 'doubleAccess',
  MULTIPLE_TARIFS = 'multipleTarifs',
  BORNE_VIP = 'borneVIP',
  DATAGOUV_STATIC_DATA = 'dataGouvStaticData',
  DATAGOUV_DYNAMIC_DATA = 'dataGouvDynamicData',


}
