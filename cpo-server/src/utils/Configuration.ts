import AsyncTaskConfiguration from '../types/configuration/AsyncTaskConfiguration';
import AuthorizationConfiguration from '../types/configuration/AuthorizationConfiguration';
import AxiosConfiguration from '../types/configuration/AxiosConfiguration';
import CentralSystemConfiguration from '../types/configuration/CentralSystemConfiguration';
import CentralSystemFrontEndConfiguration from '../types/configuration/CentralSystemFrontEndConfiguration';
import CentralSystemRestServiceConfiguration from '../types/configuration/CentralSystemRestServiceConfiguration';
import CentralSystemServerConfiguration from '../types/configuration/CentralSystemServerConfiguration';
import ChargingStationConfiguration from '../types/configuration/ChargingStationConfiguration';
import { Configuration as ConfigurationData } from '../types/configuration/Configuration';
import ConfigurationValidatorStorage from '../storage/validator/ConfigurationValidatorStorage';
import Constants from './Constants';
import CryptoConfiguration from '../types/configuration/CryptoConfiguration';
import DataGouvConfiguration from '../types/configuration/DataGouVConfigration';
import EVDatabaseConfiguration from '../types/configuration/EVDatabaseConfiguration';
import EmailConfiguration from '../types/configuration/EmailConfiguration';
import FirebaseConfiguration from '../types/configuration/FirebaseConfiguration';
import JsonEndpointConfiguration from '../types/configuration/JsonEndpointConfiguration';
import LogConfiguration from '../types/configuration/LogConfiguration';
import MigrationConfiguration from '../types/configuration/MigrationConfiguration';
import MonitoringConfiguration from '../types/configuration/MonitoringConfiguration';
import NotificationConfiguration from '../types/configuration/NotificationConfiguration';
import OCPIEndpointConfiguration from '../types/configuration/OCPIEndpointConfiguration';
import OCPIServiceConfiguration from '../types/configuration/OCPIServiceConfiguration';
import ODataServiceConfiguration from '../types/configuration/ODataServiceConfiguration';
import OICPEndpointConfiguration from '../types/configuration/OICPEndpointConfiguration';
import OICPServiceConfiguration from '../types/configuration/OICPServiceConfiguration';
import SchedulerConfiguration from '../types/configuration/SchedulerConfiguration';
import StorageConfiguration from '../types/configuration/StorageConfiguration';
import TenantDomainConfiguration from '../types/configuration/TenantDomainConfiguration';
import TraceConfiguration from '../types/configuration/TraceConfiguration';
import Utils from './Utils';
import WSDLEndpointConfiguration from '../types/configuration/WSDLEndpointConfiguration';
import chalk from 'chalk';
import fs from 'fs';
import global from './../types/GlobalType';
import PncpConfiguration from '../types/configuration/PncpConfiguration';
const MODULE_NAME = 'Configuration';

export default class Configuration {
  private static config: ConfigurationData;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getCryptoConfig(): CryptoConfiguration {
    const crypto = Configuration.getConfig().Crypto;
    if (!Configuration.isUndefined('Crypto', crypto)) {
      return crypto;
    }
  }

  public static getSchedulerConfig(): SchedulerConfiguration {
    const scheduler = Configuration.getConfig().Scheduler;
    if (!Configuration.isUndefined('Scheduler', scheduler)) {
      return scheduler;
    }
  }

  public static getAsyncTaskConfig(): AsyncTaskConfiguration {
    const asyncTask = Configuration.getConfig().AsyncTask;
    if (!Configuration.isUndefined('AsyncTask', asyncTask)) {
      return asyncTask;
    }
  }

  public static getFirebaseConfig(): FirebaseConfiguration {
    const firebaseConfiguration = Configuration.getConfig().Firebase;
    if (!Configuration.isUndefined('Firebase', firebaseConfiguration)) {
      if (firebaseConfiguration.privateKey) {
        firebaseConfiguration.privateKey = firebaseConfiguration.privateKey.replace(/\\n/g, '\n');
      }
      if (!Configuration.isEmptyArray(firebaseConfiguration.tenants)) {
        for (const tenantConfig of firebaseConfiguration.tenants) {
          tenantConfig.configuration.privateKey = tenantConfig.configuration.privateKey.replace(/\\n/g, '\n');
        }
      }
      if (firebaseConfiguration.alternativeConfiguration) {
        firebaseConfiguration.alternativeConfiguration.privateKey = firebaseConfiguration.alternativeConfiguration.privateKey.replace(/\\n/g, '\n');
      }
      return firebaseConfiguration;
    }
  }

  public static getCentralSystemsConfig(): CentralSystemConfiguration[] {
    const centralSystems = Configuration.getConfig().CentralSystems;
    if (!Configuration.isUndefined('CentralSystems', centralSystems)) {
      return centralSystems;
    }
  }

  public static getNotificationConfig(): NotificationConfiguration {
    const notification = Configuration.getConfig().Notification;
    if (!Configuration.isUndefined('Notification', notification)) {
      return notification;
    }
  }

  public static getAuthorizationConfig(): AuthorizationConfiguration {
    const authorization = Configuration.getConfig().Authorization;
    if (!Configuration.isUndefined('Authorization', authorization)) {
      return authorization;
    }
  }

  public static getCentralSystemRestServiceConfig(): CentralSystemRestServiceConfiguration {
    const centralSystemRestService = Configuration.getConfig().CentralSystemRestService;
    if (!Configuration.isUndefined('CentralSystemRestService', centralSystemRestService)) {
      if (Configuration.isUndefined('CentralSystemRestService.captchaScore', centralSystemRestService.captchaScore)) {
        centralSystemRestService.captchaScore = 0.25;
      }
      return centralSystemRestService;
    }
  }

  public static getMonitoringConfig(): MonitoringConfiguration {
    const monitoring = Configuration.getConfig().Monitoring;
    if (!Configuration.isUndefined('Monitoring', monitoring)) {
      return monitoring;
    }
  }

  public static getOCPIServiceConfig(): OCPIServiceConfiguration {
    const ocpiService = Configuration.getConfig().OCPIService;
    if (!Configuration.isUndefined('OCPIService', ocpiService)) {
      return ocpiService;
    }
  }

  public static getOICPServiceConfig(): OICPServiceConfiguration {
    const oicpService = Configuration.getConfig().OICPService;
    if (!Configuration.isUndefined('OICPService', oicpService)) {
      return oicpService;
    }
  }

  public static getODataServiceConfig(): ODataServiceConfiguration {
    const odataService = Configuration.getConfig().ODataService;
    if (!Configuration.isUndefined('ODataService', odataService)) {
      return odataService;
    }
  }

  public static getCentralSystemRestServerConfig(): CentralSystemServerConfiguration {
    const centralSystemServer = Configuration.getConfig().CentralSystemServer;
    if (!Configuration.isUndefined('CentralSystemServer', centralSystemServer)) {
      return centralSystemServer;
    }
  }

  public static getWSDLEndpointConfig(): WSDLEndpointConfiguration {
    const wsdlEndpoint = Configuration.getConfig().WSDLEndpoint;
    if (!Configuration.isUndefined('WSDLEndpoint', wsdlEndpoint)) {
      return wsdlEndpoint;
    }
  }

  public static getJsonEndpointConfig(): JsonEndpointConfiguration {
    const jsonEndpoint = Configuration.getConfig().JsonEndpoint;
    if (!Configuration.isUndefined('JsonEndpoint', jsonEndpoint)) {
      if (Configuration.isUndefined('JsonEndpoint.targetPort', jsonEndpoint.targetPort)) {
        jsonEndpoint.targetPort = 80;
      }
      return jsonEndpoint;
    }
  }

  public static getOCPIEndpointConfig(): OCPIEndpointConfiguration {
    const ocpiEndpoint = Configuration.getConfig().OCPIEndpoint;
    if (!Configuration.isUndefined('OCPIEndpoint', ocpiEndpoint)) {
      return ocpiEndpoint;
    }
  }

  public static getOICPEndpointConfig(): OICPEndpointConfiguration {
    const oicpPEndpoint = Configuration.getConfig().OICPEndpoint;
    if (!Configuration.isUndefined('OICPEndpoint', oicpPEndpoint)) {
      return oicpPEndpoint;
    }
  }

  public static getCentralSystemFrontEndConfig(): CentralSystemFrontEndConfiguration {
    const centralSystemFrontEnd = Configuration.getConfig().CentralSystemFrontEnd;
    if (!Configuration.isUndefined('CentralSystemFrontEnd', centralSystemFrontEnd)) {
      return centralSystemFrontEnd;
    }
  }

  public static getEmailConfig(): EmailConfiguration {
    const email = Configuration.getConfig().Email;
    if (!Configuration.isUndefined('Email', email)) {
      if (Configuration.isUndefined('Email.disableBackup', email.disableBackup)) {
        email.disableBackup = false;
      }
      return email;
    }
  }

  public static getEVDatabaseConfig(): EVDatabaseConfiguration {
    const evDatabase = Configuration.getConfig().EVDatabase;
    if (!Configuration.isUndefined('EVDatabase', evDatabase)) {
      return evDatabase;
    }
  }

  public static getStorageConfig(): StorageConfiguration {
    const storage = Configuration.getConfig().Storage;
    if (!Configuration.isUndefined('Storage', storage)) {
      return storage;
    }
  }

  public static getChargingStationConfig(): ChargingStationConfiguration {
    // Read conf and set defaults values
    const chargingStationConfiguration: ChargingStationConfiguration = Configuration.getConfig().ChargingStation;
    if (!Configuration.isUndefined('ChargingStation', chargingStationConfiguration)) {
      if (Configuration.isUndefined('ChargingStation.heartbeatIntervalOCPPSSecs', chargingStationConfiguration.heartbeatIntervalOCPPSSecs)) {
        chargingStationConfiguration.heartbeatIntervalOCPPSSecs = 60;
      }
      if (Configuration.isUndefined('ChargingStation.heartbeatIntervalOCPPJSecs', chargingStationConfiguration.heartbeatIntervalOCPPJSecs)) {
        chargingStationConfiguration.heartbeatIntervalOCPPJSecs = 3600;
      }
      if (Configuration.isUndefined('ChargingStation.pingIntervalOCPPJSecs', chargingStationConfiguration.pingIntervalOCPPJSecs)) {
        chargingStationConfiguration.pingIntervalOCPPJSecs = 60;
      }
      if (Configuration.isUndefined('ChargingStation.monitoringIntervalOCPPJSecs', chargingStationConfiguration.monitoringIntervalOCPPJSecs)) {
        chargingStationConfiguration.monitoringIntervalOCPPJSecs = 600;
      }
    }
    return chargingStationConfiguration;
  }

  public static getLogConfig(): LogConfiguration {
    const log = Configuration.getConfig().Logging;
    if (!Configuration.isUndefined('Logging', log)) {
      return log;
    }
  }

  public static getMigrationConfig(): MigrationConfiguration {
    const migration = Configuration.getConfig().Migration;
    if (!Configuration.isUndefined('Migration', migration)) {
      if (Configuration.isUndefined('Migration.active', Configuration.getConfig().Migration.active)) {
        migration.active = false;
      }
      return migration;
    }
  }

  public static getAxiosConfig(): AxiosConfiguration {
    const axios = Configuration.getConfig().Axios;
    if (!Configuration.isUndefined('Axios', axios)) {
      if (Configuration.isUndefined('Axios.timeoutSecs', axios.timeoutSecs)) {
        axios.timeoutSecs = Constants.AXIOS_DEFAULT_TIMEOUT_SECS;
      }
      if (Configuration.isUndefined('Axios.retries', axios.retries)) {
        axios.retries = 0;
      }
      return axios;
    }
  }

  public static getTenantDomainConfig(): TenantDomainConfiguration {
    const domain = Configuration.getConfig().TenantDomain;
    if (!Configuration.isUndefined('TenantDomain', domain)) {
      return domain;
    }
  }

  public static getDataGouvConfiguration(): DataGouvConfiguration {
    const dataGouv = Configuration.getConfig().DataGouvToken;
    if (!Configuration.isUndefined('DataGouv', dataGouv)) {
      return dataGouv;
    }
  }

  public static getTraceConfig(): TraceConfiguration {
    let trace = Configuration.getConfig().Trace;
    if (Configuration.isUndefined('Trace', trace)) {
      trace = {
        traceIngressHttp: false,
        traceEgressHttp: false,
        traceOcpp: false,
        traceDatabase: false,
        traceNotification: false,
      };
    }
    if (Configuration.isUndefined('Trace.traceIngressHttp', trace.traceIngressHttp)) {
      trace.traceIngressHttp = false;
    }
    if (Configuration.isUndefined('Trace.traceEgressHttp', trace.traceEgressHttp)) {
      trace.traceEgressHttp = false;
    }
    if (Configuration.isUndefined('Trace.traceOcpp', trace.traceOcpp)) {
      trace.traceOcpp = false;
    }
    if (Configuration.isUndefined('Trace.traceDatabase', trace.traceDatabase)) {
      trace.traceDatabase = false;
    }
    if (Configuration.isUndefined('Trace.traceNotification', trace.traceNotification)) {
      trace.traceNotification = false;
    }
    return trace;
  }

  private static getConfig(): ConfigurationData {
    if (!Configuration.config) {
      let configuration: ConfigurationData;
      if (process.env.SERVER_ROLE) {
        configuration = JSON.parse(
          fs.readFileSync(`${global.appRoot}/assets/config_` + process.env.SERVER_ROLE + '.json', 'utf8')) as ConfigurationData;
      } else {
        // K8s
        if (fs.existsSync('/config/config.json')) {
          configuration = JSON.parse(
            fs.readFileSync('/config/config.json', 'utf8')) as ConfigurationData;
          // AWS
        } else {
          configuration = JSON.parse(
            fs.readFileSync(`${global.appRoot}/assets/config.json`, 'utf8')) as ConfigurationData;
        }
      }
      Configuration.config = ConfigurationValidatorStorage.getInstance().validateConfigurationSave(configuration);
    }
    return Configuration.config;
  }

  // Dup method: Avoid circular deps with Utils class
  private static isUndefined(name: string, value: any): boolean {
    if (typeof value === 'undefined') {
      console.error(chalk.yellow(`[Warning] Missing property '${name}' in config.json`));
      return true;
    }
    return false;
  }

  // Dup method: Avoid circular deps with Utils class
  private static isEmptyArray(array: any): boolean {
    if (!array) {
      return true;
    }
    if (Array.isArray(array) && array.length > 0) {
      return false;
    }
    return true;
  }
  
  public static getPncpConfig(): PncpConfiguration {
    const pncp = Configuration.getConfig().Pncp;
    if (!Configuration.isUndefined('Pncp', pncp)) {
      // Valeurs par défaut pour les propriétés manquantes
      return {
        baseUrl: pncp.baseUrl ?? 'https://api.gireve.com/pncp',
        apiKey: pncp.apiKey ?? 'your-api-key-here',
        timeout: pncp.timeout ?? 30000,
        enabled: pncp.enabled ?? false,
        profileId: pncp.profileId ?? 'DEFAULT_PROFILE',
        countryCode: pncp.countryCode ?? 'FR',
        partyId: pncp.partyId ?? 'CPO',
      };
    }
    // Config par défaut si Pncp est absent
    return {
      baseUrl: 'https://api.gireve.com/pncp',
      apiKey: 'your-api-key-here',
      timeout: 30000,
      enabled: false,
      profileId: 'DEFAULT_PROFILE',
      countryCode: 'FR',
      partyId: 'CPO',
    };
  }
}