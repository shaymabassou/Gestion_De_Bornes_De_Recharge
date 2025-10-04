/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { AuthorizeRequest, AuthorizeResponse, CertificateStatus, ChargePointErrorCode, ChargePointStatus, data,  OCPPAttribute, OCPPAuthorizationStatus, OCPPAuthorizeRequest, OCPPAuthorizeRequestExtended, OCPPAuthorizeResponse, OCPPBootNotificationRequestExtended, OCPPBootNotificationResponse,  OCPPCertificateHashDataType, OCPPCertificateSignedRequest, OCPPCertificateSignedResponse, OCPPDataTransferRequestExtended, OCPPDataTransferResponse, OCPPDataTransferStatus, OCPPDeleteCertificateRequest, OCPPDeleteCertificateResponse, OCPPDiagnosticsStatusNotificationRequestExtended, OCPPDiagnosticsStatusNotificationResponse, OCPPFirmwareStatusNotificationRequestExtended, OCPPFirmwareStatusNotificationResponse, OCPPGetCertificateIdUseType, GetInstalledCertificateIdsRequest, GetInstalledCertificateIdsResponse, OCPPHeartbeatRequestExtended, OCPPHeartbeatResponse, OCPPInstallCertificateRequest, OCPPInstallCertificateResponse,  OCPPInstallCertificateUseType,  OCPPLocation, OCPPMeasurand, OCPPMeterValue, OCPPMeterValuesRequest, OCPPMeterValuesRequestExtended, OCPPMeterValuesResponse, OCPPNormalizedMeterValue, OCPPNormalizedMeterValues, OCPPPhase, OCPPProtocol, OCPPReadingContext, OCPPSampledValue, OCPPStartTransactionRequestExtended, OCPPStartTransactionResponse, OCPPStatusNotificationRequestExtended, OCPPStatusNotificationResponse, OCPPStopTransactionRequestExtended, OCPPStopTransactionResponse,  OCPPUnitOfMeasure, OCPPValueFormat, OCPPVersion, RegistrationStatus, SignCertificateRequest, SignCertificateResponse, GetInstalledCertificateStatusEnum } from '../../../types/ocpp/OCPPServer';
import { ChargingProfilePurposeType, ChargingRateUnitType } from '../../../types/ChargingProfile';
import ChargingStation, { ChargerVendor, Connector, ConnectorCurrentLimitSource, ConnectorType, CurrentType, StaticLimitAmps } from '../../../types/ChargingStation';
import Tenant, { TenantComponents } from '../../../types/Tenant';
import Transaction, { InactivityStatus, TransactionAction } from '../../../types/Transaction';
import crypto, { CipherGCMTypes, randomUUID, X509Certificate } from 'crypto';

import { Action } from '../../../types/Authorization';
import BackendError from '../../../exception/BackendError';
import BillingFacade from '../../../integration/billing/BillingFacade';
import CarConnectorFactory from '../../../integration/car-connector/CarConnectorFactory';
import CarStorage from '../../../storage/mongodb/CarStorage';
import ChargingStationClientFactory from '../../../client/ocpp/ChargingStationClientFactory';
import ChargingStationConfiguration from '../../../types/configuration/ChargingStationConfiguration';
import ChargingStationStorage from '../../../storage/mongodb/ChargingStationStorage';
import { CommonUtilsService } from '../../CommonUtilsService';
import Constants from '../../../utils/Constants';
import Consumption from '../../../types/Consumption';
import ConsumptionStorage from '../../../storage/mongodb/ConsumptionStorage';
import LockingHelper from '../../../locking/LockingHelper';
import LockingManager from '../../../locking/LockingManager';
import Logging from '../../../utils/Logging';
import LoggingHelper from '../../../utils/LoggingHelper';
import NotificationHandler from '../../../notification/NotificationHandler';
import NotificationHelper from '../../../utils/NotificationHelper';
import OCPIFacade from '../../ocpi/OCPIFacade';
import OCPPCommon from '../utils/OCPPCommon';
import { OCPPHeader } from '../../../types/ocpp/OCPPHeader';
import { OCPPDataTransferRequest, OCPPRemoteStartStopStatus } from '../../../types/ocpp/OCPPClient';
import OCPPStorage from '../../../storage/mongodb/OCPPStorage';
import OCPPUtils from '../utils/OCPPUtils';
import OCPPValidator from '../validator/OCPPValidator';
import OICPFacade from '../../oicp/OICPFacade';
import PricingFacade from '../../../integration/pricing/PricingFacade';
import { ServerAction } from '../../../types/Server';
import SiteArea from '../../../types/SiteArea';
import SiteAreaStorage from '../../../storage/mongodb/SiteAreaStorage';
import SmartChargingFactory from '../../../integration/smart-charging/SmartChargingFactory';
import TagStorage from '../../../storage/mongodb/TagStorage';
import TransactionStorage from '../../../storage/mongodb/TransactionStorage';
import User from '../../../types/User';
import UserStorage from '../../../storage/mongodb/UserStorage';
import Utils from '../../../utils/Utils';
import UtilsService from '../../rest/v1/service/UtilsService';
import forge from 'node-forge';
import { json } from 'body-parser';
import moment from 'moment';
import momentDurationFormatSetup from 'moment-duration-format';
import { CertificateService } from './CertificateService';
import JsonChargingStationClient from '../../../client/ocpp/json/JsonChargingStationClient';
import JsonWSConnection from '../json/web-socket/JsonWSConnection';
import { ObjectId } from 'mongodb';
import ChargingStationClient from '../../../client/ocpp/ChargingStationClient';
import CertificateStorage from '../../../storage/mongodb/CertificateStorage';
import { Certificate } from '../../../types/Certificate';
import EmaidStorage from '../../../storage/mongodb/EmaidStorage';
import { request } from 'https';

momentDurationFormatSetup(moment as any);

const MODULE_NAME = 'OCPPService';

export default class OCPPService {
  private chargingStationConfig: ChargingStationConfiguration;

  public constructor(chargingStationConfig: ChargingStationConfiguration) {
    this.chargingStationConfig = chargingStationConfig;
  }

public async handleBootNotification(headers: OCPPHeader, bootNotification: OCPPBootNotificationRequestExtended): Promise<OCPPBootNotificationResponse> {
  try {
    const { tenant } = headers;
    let { chargingStation } = headers;
    OCPPValidator.getInstance().validateBootNotification(headers, bootNotification);
    // Enrich Boot Notification
    this.enrichBootNotification(headers, bootNotification);
    // Get heartbeat interval
    const heartbeatIntervalSecs = this.getHeartbeatInterval(headers.ocppProtocol);
    // Check Charging Station
    if (!chargingStation) {
      // Create Charging Station
      chargingStation = await this.createChargingStationFromBootNotification(tenant, bootNotification, headers);
    } else {
      // Validate Charging Station
      this.checkChargingStationIsIdenticalFromBootNotification(chargingStation, bootNotification);
    }
    // Enrich Charging Station
    await this.enrichChargingStationFromBootNotification(tenant, chargingStation, headers, bootNotification);
    // Apply template
    await OCPPUtils.checkAndApplyTemplateToChargingStation(tenant, chargingStation, false);
    // Save Charging Station
    await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
    // Save Boot Notification
    await OCPPStorage.saveBootNotification(tenant, bootNotification);
    // Notify
    this.notifyBootNotification(tenant, chargingStation);
    // Get Charging Station Client
    const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);

    // Parse the certificate data
    const certificateData = JSON.parse('{"certificateType":"V2GRootCertificate","certificate":"-----BEGIN CERTIFICATE-----\\nMIIB3jCCAYSgAwIBAgIUPxR2jngFIBQ+Hsdn71JJRoxuNZIwCgYIKoZIzj0EawIw\\nRTELMAkGA1UEBhMCRlIxDDAKBgNVBAoMA0lFUzETMBEGA1UEAwwKQ1BPX0FfUm9v\\ndDETMBEGCgmSJomT8ixkARkWA1YyRzAgFw0yMzEwMTEwODU4MTRaGA8yMDYzMTAw\\nMTA4NTgxNFowRTELMAkGA1UEBhMCRlIxDDAKBgNVBAoMA0lFUzETMBEGA1UEAwwK\\nQ1BPX0FfUm9vdDETMBEGCgmSJomT8ixkARkWA1YyRzBZMBMGByqGSM49AgEGCCqG\\nSM49AwEHA0IABL4xZIn3KtXP99nsGYejuJ6kUcXMJtOcaFfLiXdtfhaIpdjN6NbP\\n38xt8WuHo7tToGuqIYjuOY4F0wPfCiqGHbejUDBOMB0GA1UdDgQWBBRJQJwqwfSz\\neu5AuSsP9zes7ewVIjAfBgNVHSMEGDAWgBRJQJwqwfSzeu5AuSsP9zes7ewVIjAM\\nBgNVHRMEBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQDdNC6WF60mzj2qva9XyfEk\\nx3FQHIIXFRAcg0/DaUTeVAIgWlqpfFy8MWHH+PvgYlsjMoF7pgTZOt7ZPbD3RV/E\\n2uw=\\n-----END CERTIFICATE-----"}');

    // Request OCPP configuration
    setTimeout(async () => {
      await OCPPCommon.requestAndSaveChargingStationOcppParameters(tenant, chargingStation);
    }, Constants.DELAY_CHANGE_CONFIGURATION_EXECUTION_MILLIS);
// Request Installed Certificate IDs
    setTimeout(async () => {
      await this.handleGetInstalledCertificateIds(chargingStationClient, tenant, chargingStation, { certificateType: 'V2GRootCertificate' });
    }, Constants.DELAY_CHANGE_CONFIGURATION_EXECUTION_MILLIS);
    


    // Request Certificate Installation
    setTimeout(async () => {
      const certificateResponse = await this.requestInstallCertificate(chargingStationClient, tenant, chargingStation, {
        certificate: certificateData.certificate,
        certificateType: certificateData.certificateType,
      });
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        action: ServerAction.OCPP_BOOT_NOTIFICATION,
        module: MODULE_NAME,
        method: 'handleBootNotification',
        message: `Résultat de la demande d'installation du certificat : ${certificateResponse.status}`,
        detailedMessages: { certificateResponse },
      });
    }, Constants.DELAY_CHANGE_CONFIGURATION_EXECUTION_MILLIS);

    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      action: ServerAction.OCPP_BOOT_NOTIFICATION,
      module: MODULE_NAME,
      method: 'handleBootNotification',
      message: 'Boot Notification has been accepted',
      detailedMessages: { bootNotification },
    });

    // Accept
    return {
      currentTime: bootNotification.timestamp.toISOString(),
      status: RegistrationStatus.ACCEPTED,
      interval: heartbeatIntervalSecs,
    };
  } catch (error) {
    this.addChargingStationToException(error, headers.chargeBoxIdentity);
    await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_BOOT_NOTIFICATION, error, { bootNotification });
    // Reject
    return {
      status: RegistrationStatus.REJECTED,
      currentTime: bootNotification.timestamp ? bootNotification.timestamp.toISOString() : new Date().toISOString(),
      interval: Constants.BOOT_NOTIFICATION_WAIT_TIME,
    };
  }
}
  public async handleHeartbeat(headers: OCPPHeader, heartbeat: OCPPHeartbeatRequestExtended): Promise<OCPPHeartbeatResponse> {
    try {
      // Get the header infos
      const { chargingStation, tenant } = headers;
      if (!heartbeat) {
        heartbeat = {} as OCPPHeartbeatRequestExtended;
      }
      OCPPValidator.getInstance().validateHeartbeat(heartbeat);
      // Set Heart Beat Object
      heartbeat.chargeBoxID = chargingStation.id;
      heartbeat.timestamp = new Date();
      heartbeat.timezone = Utils.getTimezone(chargingStation.coordinates);
      // Save Heart Beat
      await OCPPStorage.saveHeartbeat(tenant, heartbeat);
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleHeartbeat',
        action: ServerAction.OCPP_HEARTBEAT,
        message: 'Heartbeat saved',
        detailedMessages: { heartbeat }
      });
      return {
        currentTime: new Date().toISOString()
      };
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_HEARTBEAT, error, { heartbeat });
      return {
        currentTime: new Date().toISOString()
      };
    }
  }

  public async handleStatusNotification(headers: OCPPHeader, statusNotification: OCPPStatusNotificationRequestExtended): Promise<OCPPStatusNotificationResponse> {
    try {
      // Get the header infos
      const { chargingStation, tenant } = headers;
      // Check props
      OCPPValidator.getInstance().validateStatusNotification(statusNotification);
      // Set Header
      this.enrichOCPPRequest(chargingStation, statusNotification, false);
      // Skip connectorId = 0 case
      if (statusNotification.connectorId <= 0) {
        await Logging.logInfo({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          action: ServerAction.OCPP_STATUS_NOTIFICATION,
          module: MODULE_NAME, method: 'handleStatusNotification',
          message: `Connector ID '0' > ${this.buildStatusNotification(statusNotification)}, will be ignored (Connector ID = '0')`,
          detailedMessages: { statusNotification }
        });
      } else {
        // Update only the given Connector ID
        await this.processConnectorFromStatusNotification(tenant, chargingStation, statusNotification);
      }
      return {};
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_STATUS_NOTIFICATION, error, { statusNotification });
      return {};
    }
  }

  public async handleMeterValues(headers: OCPPHeader, meterValues: OCPPMeterValuesRequestExtended): Promise<OCPPMeterValuesResponse> {
    try {
      // Get the header infos
      const { chargingStation, tenant } = headers;
      await OCPPValidator.getInstance().validateMeterValues(tenant.id, chargingStation, meterValues);
      // Normalize Meter Values
      const normalizedMeterValues = this.normalizeMeterValues(chargingStation, meterValues);
      // Handle Charging Station's specificities
      this.filterMeterValuesOnSpecificChargingStations(tenant, chargingStation, normalizedMeterValues);
      if (Utils.isEmptyArray(normalizedMeterValues.values)) {
        await Logging.logDebug({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'handleMeterValues',
          action: ServerAction.OCPP_METER_VALUES,
          message: 'No relevant Meter Values to save',
          detailedMessages: { meterValues }
        });
        return {};
      }
      // Get Transaction
      const transaction = await this.getTransactionFromMeterValues(tenant, chargingStation, headers, meterValues);
      // Save Meter Values
      await OCPPStorage.saveMeterValues(tenant, normalizedMeterValues);
      // Update Transaction
      this.updateTransactionWithMeterValues(chargingStation, transaction, normalizedMeterValues.values);
      // Create Consumptions
      const consumptions = await OCPPUtils.createConsumptionsFromMeterValues(tenant, chargingStation, transaction, normalizedMeterValues.values);
      // Handle current SOC
      await this.processTransactionCar(tenant, transaction, chargingStation, consumptions[consumptions.length - 1], null, TransactionAction.UPDATE);
      // Price/Bill Transaction and Save them
      for (const consumption of consumptions) {
        // Update Transaction with Consumption
        OCPPUtils.updateTransactionWithConsumption(chargingStation, transaction, consumption);
        if (consumption.toPrice) {
          // Pricing
          await PricingFacade.processUpdateTransaction(tenant, transaction, chargingStation, consumption, transaction.user);
          // Billing
          await BillingFacade.processUpdateTransaction(tenant, transaction, transaction.user);
        }
        // Save
        await ConsumptionStorage.saveConsumption(tenant, consumption);
      }
      // Get the phases really used from Meter Values (for AC single phase charger/car)
      if (!transaction.phasesUsed &&
        Utils.checkIfPhasesProvidedInTransactionInProgress(transaction) &&
        transaction.numberOfMeterValues >= 1) {
        transaction.phasesUsed = Utils.getUsedPhasesInTransactionInProgress(chargingStation, transaction);
      }
      // OCPI
      await OCPIFacade.processUpdateTransaction(tenant, transaction, chargingStation, chargingStation.siteArea, transaction.user, ServerAction.OCPP_METER_VALUES);
      // OICP
      await OICPFacade.processUpdateTransaction(tenant, transaction, chargingStation, chargingStation.siteArea, transaction.user, ServerAction.OCPP_METER_VALUES);
      // Save Transaction
      await TransactionStorage.saveTransaction(tenant, transaction);
      // Update Charging Station
      await OCPPUtils.updateChargingStationConnectorRuntimeDataWithTransaction(tenant, chargingStation, transaction);
      // Save Charging Station
      await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
      // Handle End Of charge
      await this.checkNotificationEndOfCharge(tenant, chargingStation, transaction);
      // First Meter Value -> Trigger Smart Charging to adjust the limit
      if (transaction.numberOfMeterValues === 1 && transaction.phasesUsed) {
        // Yes: Trigger Smart Charging
        await this.triggerSmartCharging(tenant, chargingStation.siteArea);
      }
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        action: ServerAction.OCPP_METER_VALUES,
        user: transaction.userID,
        module: MODULE_NAME, method: 'handleMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)}  MeterValue have been saved`,
        detailedMessages: { normalizedMeterValues }
      });
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_METER_VALUES, error, { meterValues });
    }
    return {};
  }

  public async handleAuthorize(headers: OCPPHeader, authorize: OCPPAuthorizeRequestExtended): Promise<OCPPAuthorizeResponse> {
    try {
      const { chargingStation, tenant } = headers;
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleAuthorize',
        action: ServerAction.OCPP_AUTHORIZE,
        message: 'Préparation de l’autorisation de l’utilisateur.',
        detailedMessages: { authorize },
      });

      OCPPValidator.getInstance().validateAuthorize(authorize);

      // Gestion Plug & Charge (ISO 15118)
      if (authorize.iso15118CertificateHashData) {
        const isValid = CertificateService.verifyCertificate(authorize.iso15118CertificateHashData.certificateChain, authorize.iso15118CertificateHashData[0]);
        if (!isValid) {
          await Logging.logWarning({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            module: MODULE_NAME,
            method: 'handleAuthorize',
            action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
            message: 'Certificat ISO 15118 invalide.',
            detailedMessages: { authorize },
          });
          return {
            idTokenInfo: {
              status: OCPPAuthorizationStatus.INVALID,
            },
          };
        }

        await Logging.logInfo({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'handleAuthorize',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: 'Utilisateur authentifié via Plug & Charge.',
          detailedMessages: { authorize },
        });

        return {
          idTokenInfo: {
            status: OCPPAuthorizationStatus.ACCEPTED,
          },
        };
      }

      // Gestion RFID (inchangée)
      const { user } = await CommonUtilsService.isAuthorizedOnChargingStation(
        tenant, chargingStation, authorize.idTag, ServerAction.OCPP_AUTHORIZE, Action.AUTHORIZE
      );

      await OCPPUtils.checkBillingPrerequisites(tenant, ServerAction.OCPP_AUTHORIZE, chargingStation, user);
      this.enrichAuthorize(user, chargingStation, headers, authorize);
      await OCPPStorage.saveAuthorize(tenant, authorize);

      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleAuthorize',
        action: ServerAction.OCPP_AUTHORIZE,
        user: authorize.user ? authorize.user : null,
        message: `Utilisateur autorisé avec le badge '${authorize.idTag}'`,
        detailedMessages: { authorize },
      });

      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.ACCEPTED,
        },
      };
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_AUTHORIZE, error, { authorize });
      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID,
        },
      };
    }
  }

  public async handleDiagnosticsStatusNotification(headers: OCPPHeader,
      diagnosticsStatusNotification: OCPPDiagnosticsStatusNotificationRequestExtended): Promise<OCPPDiagnosticsStatusNotificationResponse> {
    // Get the header infos
    const { chargingStation, tenant } = headers;
    try {
      // Check props
      OCPPValidator.getInstance().validateDiagnosticsStatusNotification(diagnosticsStatusNotification);
      // Enrich
      this.enrichOCPPRequest(chargingStation, diagnosticsStatusNotification);
      // Save it
      await OCPPStorage.saveDiagnosticsStatusNotification(tenant, diagnosticsStatusNotification);
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        action: ServerAction.OCPP_DIAGNOSTICS_STATUS_NOTIFICATION,
        module: MODULE_NAME, method: 'handleDiagnosticsStatusNotification',
        message: 'Diagnostics Status Notification has been saved',
        detailedMessages: { diagnosticsStatusNotification }
      });
      return {};
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_DIAGNOSTICS_STATUS_NOTIFICATION, error, { diagnosticsStatusNotification });
      return {};
    }
  }

  public async handleFirmwareStatusNotification(headers: OCPPHeader,
      firmwareStatusNotification: OCPPFirmwareStatusNotificationRequestExtended): Promise<OCPPFirmwareStatusNotificationResponse> {
    // Get the header infos
    const { chargingStation, tenant } = headers;
    try {
      // Check props
      OCPPValidator.getInstance().validateFirmwareStatusNotification(chargingStation, firmwareStatusNotification);
      // Enrich
      this.enrichOCPPRequest(chargingStation, firmwareStatusNotification);
      // Save the status to Charging Station
      await ChargingStationStorage.saveChargingStationFirmwareStatus(tenant, chargingStation.id, firmwareStatusNotification.status);
      // Save it
      await OCPPStorage.saveFirmwareStatusNotification(tenant, firmwareStatusNotification);
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleFirmwareStatusNotification',
        action: ServerAction.OCPP_FIRMWARE_STATUS_NOTIFICATION,
        message: `Firmware Status Notification '${firmwareStatusNotification.status}' has been saved`,
        detailedMessages: { firmwareStatusNotification }
      });
      return {};
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_FIRMWARE_STATUS_NOTIFICATION, error, { firmwareStatusNotification });
      return {};
    }
  }

  public async handleStartTransaction(headers: OCPPHeader, startTransaction: OCPPStartTransactionRequestExtended): Promise<OCPPStartTransactionResponse> {
    try {
      // Get the header infos
      const { chargingStation, tenant } = headers;
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleStartTransaction',
        action: ServerAction.OCPP_START_TRANSACTION,
        message: 'Preparing server to start Transaction',
        detailedMessages: { transaction: startTransaction }
      });
      // Check props
      OCPPValidator.getInstance().validateStartTransaction(chargingStation, startTransaction);
      // Enrich
      this.enrichStartTransaction(tenant, startTransaction, chargingStation);
      // Create Transaction
      const newTransaction = await this.createTransaction(tenant, startTransaction);
      console.log("OCPPService ~ handleStartTransaction ~ newTransaction:", newTransaction)
      // Check User
      const { user, tag } = await CommonUtilsService.isAuthorizedToStartTransaction(
        tenant, chargingStation, startTransaction.tagID, newTransaction, ServerAction.OCPP_START_TRANSACTION, Action.START_TRANSACTION);
      console.log("OCPPService ~ handleStartTransaction ~ user:", user)
      if (user) {
        startTransaction.userID = user.id;
        newTransaction.userID = user.id;
        newTransaction.user = user;
        newTransaction.authorizationID = user.authorizationID;
      }
      newTransaction.tag = tag;
      console.log("OCPPService ~ handleStartTransaction ~ tag:", tag)
      if (Utils.isTenantComponentActive(tenant, TenantComponents.BORNE_VIP) && ((user.role !== 'A'))) {
        console.log("OCPPService ~ handleStartTransaction ~ user.role:", user.role)
        try {
          const chargingStationGot = await ChargingStationStorage.getChargingStation(tenant,startTransaction.chargeBoxID);
          console.log("OCPPService ~ handleStartTransaction ~ chargingStationGot:", chargingStationGot)
          const connectorVIP = chargingStationGot.connectors.find((connectorVip) => connectorVip.connectorId === startTransaction.connectorId);
          console.log("OCPPService ~ handleStartTransaction ~ connectorVIP:", connectorVIP)
          console.log("OCPPService ~ handleStartTransaction ~ transactionId: second tryy ------")
          if (connectorVIP && (connectorVIP.isPrivate) && (!connectorVIP.ownerIds.includes(user.id))) {
            return {
              transactionId: 0,
              idTagInfo: {
                status: OCPPAuthorizationStatus.INVALID
              }
            };
          }
        } catch (error) {
          console.log('-----------------error : ', error);
          console.log('--------------------the charging station : ',chargingStation);
        }
      }
      console.log("OCPPService ~ handleStartTransaction ~ chargingStation:", chargingStation)
      console.log("OCPPService ~ handleStartTransaction ~ tenant:", tenant)
      console.log("OCPPService ~ handleStartTransaction ~ newTransaction:", newTransaction)
      // Cleanup ongoing Transaction
      await this.processExistingTransaction(tenant, chargingStation, startTransaction.connectorId);
      console.log("OCPPService ~ handleStartTransaction ~ 1:")

      // Handle Car
      await this.processTransactionCar(tenant, newTransaction, chargingStation, null, user, TransactionAction.START);
      console.log("OCPPService ~ handleStartTransaction ~ 2:")

      // Create consumption
      const firstConsumption = await OCPPUtils.createFirstConsumption(tenant, chargingStation, newTransaction);
      console.log("OCPPService ~ handleStartTransaction ~ 3:")

      // Pricing
      await PricingFacade.processStartTransaction(tenant, newTransaction, chargingStation, firstConsumption, user);
      console.log("OCPPService ~ handleStartTransaction ~ 4:")

      // Billing
      await BillingFacade.processStartTransaction(tenant, newTransaction, chargingStation, chargingStation.siteArea, user);
      console.log("OCPPService ~ handleStartTransaction ~ 5:")

      // OCPI
      await OCPIFacade.processStartTransaction(tenant, newTransaction, chargingStation, chargingStation.siteArea, tag, user, ServerAction.OCPP_START_TRANSACTION);
      console.log("OCPPService ~ handleStartTransaction ~ 6:")

      // OICP
      await OICPFacade.processStartTransaction(tenant, newTransaction, chargingStation, chargingStation.siteArea, user, ServerAction.OCPP_START_TRANSACTION);
      console.log("OCPPService ~ handleStartTransaction ~ 7:")

      // Save it
      await TransactionStorage.saveTransaction(tenant, newTransaction);
      console.log("OCPPService ~ handleStartTransaction ~ 8:")

      // Clean up
      await OCPPUtils.updateChargingStationConnectorRuntimeDataWithTransaction(tenant, chargingStation, newTransaction);
      console.log("OCPPService ~ handleStartTransaction ~ 9:")

      // Save
      await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
      console.log("OCPPService ~ handleStartTransaction ~ 10:")

      // Notify
      NotificationHelper.notifyStartTransaction(tenant, newTransaction, chargingStation, user);
      console.log("OCPPService ~ handleStartTransaction ~ 11:")

      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleStartTransaction',
        action: ServerAction.OCPP_START_TRANSACTION, user: user,
        message: `${Utils.buildConnectorInfo(newTransaction.connectorId, newTransaction.id)} Transaction has been started successfully`,
        detailedMessages: { transaction: newTransaction, startTransaction }
      });
      // Accepted
      console.log("OCPPService ~ handleStartTransaction ~ transactionId: return -----")
      return {
        transactionId: newTransaction.id,
        idTagInfo: {
          status: OCPPAuthorizationStatus.ACCEPTED
        }
      };
    } catch (error) {
      console.log('handleStartTransaction error:', error.message);
      console.log("OCPPService ~ handleStartTransaction ~ transactionId: Last catch ------")
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_START_TRANSACTION, error, { startTransaction });
      // Invalid
      return {
        transactionId: 0,
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID
        }
      };
    }
  }
  public async handleDataTransfer(headers: OCPPHeader, dataTransfer: OCPPDataTransferRequestExtended): Promise<OCPPDataTransferResponse> {
    console.log('Message DataTransfer reçu du simulateur :', JSON.stringify(dataTransfer, null, 2));
    try {
      const { chargingStation, tenant } = headers;

      // Valider les données de la requête
      OCPPValidator.getInstance().validateDataTransfer(chargingStation, dataTransfer);

      // Enrichir la requête avec des informations supplémentaires
      this.enrichOCPPRequest(chargingStation, dataTransfer);

      // Vérifier si le message est lié à ISO 15118
      if (dataTransfer.vendorId === 'org.openchargealliance.iso15118pnc') {
        const data = dataTransfer.data && dataTransfer.data !== '' ? JSON.parse(dataTransfer.data) : {};

        // Obtenir le client pour communiquer avec la borne
        const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
        if (!chargingStationClient) {
          throw new Error('Charging Station client not available');
        }

        let response: OCPPDataTransferResponse;
        switch (dataTransfer.messageId) {
          case 'Authorize':
            response = await this.handleISO15118Authorize(tenant, chargingStation, data, headers);
            break;

          case 'GetInstalledCertificateIds':
            response = await this.handleGetInstalledCertificateIds(chargingStationClient, tenant, chargingStation, data);
            break;

          case 'InstallCertificate':
            response = await this.requestInstallCertificate(chargingStationClient, tenant, chargingStation, data);
            break;

            case 'InstallCertificateToBackend':
              response = await this.handleInstallCertificate( tenant, chargingStation, data);
              break;
          case 'DeleteCertificate':
            response = await this.requestDeleteCertificate(chargingStationClient, tenant, chargingStation, data);
            break;

            case 'DeleteCertificateToBackend':
            response = await this.handleDeleteCertificate(chargingStationClient, tenant, chargingStation, data);
            break;

          case 'SignCertificate':
            response = await this.handleSignCertificate(tenant, chargingStationClient, chargingStation, data);
            break;

          case 'CertificateSigned':
            response = await this.requestCertificateSigned(chargingStationClient, tenant, chargingStation, data);
            break;
          case 'TriggerMessage': 
            response = await this.requestTriggerMessage(chargingStationClient, tenant, chargingStation, data);
            break;
          case 'GetCertificateStatus': 
            response = await this.handleGetCertificateStatus(tenant, chargingStation, data, headers);
            break;
          
          

          default:
            await Logging.logWarning({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              module: MODULE_NAME,
              method: 'handleDataTransfer',
              action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
              message: `Unsupported ISO 15118 message: ${dataTransfer.messageId}`,
              detailedMessages: { dataTransfer },
            });
            response = { status: OCPPDataTransferStatus.REJECTED };
            break;
        }

        // Sauvegarder la requête et logger uniquement si le traitement a réussi
        if (response.status === OCPPDataTransferStatus.ACCEPTED) {
          await OCPPStorage.saveDataTransfer(tenant, dataTransfer);
          await Logging.logInfo({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            module: MODULE_NAME,
            method: 'handleDataTransfer',
            action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
            message: 'Data Transfer has been processed successfully',
            detailedMessages: { dataTransfer, response },
          });
        }

        return response;
      }

      // Si ce n'est pas un message ISO 15118, retourner ACCEPTED par défaut
      return { status: OCPPDataTransferStatus.ACCEPTED };
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.CHARGING_STATION_DATA_TRANSFER, error, { dataTransfer });
      return { status: OCPPDataTransferStatus.REJECTED };
    }
  }

  private async handleISO15118Authorize(tenant: Tenant,chargingStation: ChargingStation,data: any,headers: OCPPHeader): Promise<OCPPDataTransferResponse> {
  try {
    console.log('Données reçues pour ISO 15118 :', JSON.stringify(data, null, 2));

    // Nettoyer le certificateChain de manière robuste
    let certificateChain = data.certificateChain
      .replace(/\\+n/g, '\n') // Remplacer \\n ou \\\\n par \n
      .replace(/\r\n|\r/g, '\n') // Normaliser les sauts de ligne
      .trim();

    // Extraire l'en-tête, le contenu et le footer
    const pemHeader = '-----BEGIN CERTIFICATE-----';
    const pemFooter = '-----END CERTIFICATE-----';
    const headerMatch = certificateChain.match(/-----[\s]*BEGIN[\s]*CERTIFICATE[\s]*-----/);
    const footerMatch = certificateChain.match(/-----[\s]*END[\s]*CERTIFICATE[\s]*-----/);

    if (!headerMatch || !footerMatch) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid PEM certificate format: missing header or footer.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }

    // Extraire le contenu Base64 (entre l'en-tête et le footer)
    const startIndex = certificateChain.indexOf(headerMatch[0]) + headerMatch[0].length;
    const endIndex = certificateChain.indexOf(footerMatch[0]);
    let base64Content = certificateChain.substring(startIndex, endIndex).trim();

    // Supprimer tous les espaces et caractères non-Base64 du contenu
    base64Content = base64Content
      .replace(/\s+/g, '') // Supprimer tous les espaces
      .replace(/[^A-Za-z0-9+/=]/g, ''); // Conserver uniquement les caractères Base64 valides

    // Reformer le certificat
    certificateChain = `${pemHeader}\n${base64Content.match(/.{1,64}/g)?.join('\n') || base64Content}\n${pemFooter}`;

    // Log pour déboguer
    await Logging.logDebug({
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleISO15118Authorize',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Cleaned certificate chain: ${certificateChain}`,
    });

    // Mettre à jour data.certificateChain
    data.certificateChain = certificateChain;

    // Validate certificate-related input data
    if (!data?.iso15118CertificateHashData?.[0] || !data?.certificateChain) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid ISO 15118 certificate data provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }

    // Verify the ISO 15118 certificate
    const isValid = CertificateService.verifyCertificate(data.certificateChain, data.iso15118CertificateHashData[0]);
    console.log('Certificate verification result:', isValid);
    if (!isValid) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid ISO 15118 certificate provided.',
        detailedMessages: { data },
      });
      console.log('Returning REJECTED due to invalid certificate');
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }

    // Check if the certificate is installed in the database
    const installedCertificate = await CertificateStorage.getCertificateByChain(tenant, data.certificateChain);
    if (!installedCertificate) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Certificate not found in database.',
        detailedMessages: { data },
      });
      console.log('Returning REJECTED due to certificate not installed');
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }

    // Check if idToken is present in the data object
    if (!data.idToken) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Missing idToken in ISO 15118 authorization request.',
        detailedMessages: { data },
      });
      console.log('Returning REJECTED due to missing idToken');
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }

    // Vérifier si l'idToken existe dans la base de données comme emaid
    const emaid = await EmaidStorage.getEmaid(tenant, data.idToken);
    if (!emaid) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleISO15118Authorize',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `idToken '${data.idToken}' not found in emaids database.`,
        detailedMessages: { data },
      });
      console.log('Returning REJECTED due to idToken not found in database');
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
      };
    }
// Vérifier si l'EMAID est actif
if (!emaid.active) {
  await Logging.logWarning({
    ...LoggingHelper.getChargingStationProperties(chargingStation),
    tenantID: tenant.id,
    module: MODULE_NAME,
    method: 'handleISO15118Authorize',
    action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
    message: `idToken '${data.idToken}' is inactive and cannot be used for authorization.`,
    detailedMessages: { data, emaid },
  });
  console.log('Returning REJECTED due to inactive EMAID');
  return {
    status: OCPPDataTransferStatus.REJECTED,
    data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
  };
}
    // Authentication successful
    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleISO15118Authorize',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Utilisateur authentifié via ISO 15118 Plug & Charge avec idToken '${data.idToken}'`,
      detailedMessages: { data, emaid, installedCertificate },
    });

    console.log('idToken found in database:', data.idToken);

    // Extract connectorId from data, default to 1 if not provided
    const connectorId = data.connectorId ? Number(data.connectorId) : 1;
    console.log('Using connectorId:', connectorId);

    // Déclencher RemoteStartTransaction
    if (isValid && emaid && installedCertificate) {
      const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
      if (chargingStationClient) {
        await chargingStationClient.remoteStartTransaction({
          connectorId: connectorId,
          idTag: data.idToken,
          // idEmaid: data.idToken,
        });
        await Logging.logInfo({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'handleISO15118Authorize',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: `RemoteStartTransaction triggered for connector ${connectorId} with idToken '${data.idToken}'.`,
        });
      } else {
        await Logging.logWarning({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'handleISO15118Authorize',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: 'Charging station client not available, unable to trigger RemoteStartTransaction.',
        });
      }
    }
    console.log('Returning ACCEPTED');
    return {
      status: OCPPDataTransferStatus.ACCEPTED,
      data: JSON.stringify({
        idTokenInfo: { status: OCPPAuthorizationStatus.ACCEPTED },
        certificateStatus: 'Accepted',
      }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleISO15118Authorize',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error during ISO 15118 authorization.',
      detailedMessages: { error: error.stack },
    });
    return { status: OCPPDataTransferStatus.REJECTED };
  }
}
 private async handleGetInstalledCertificateIds(
    chargingStationClient: ChargingStationClient,
    tenant: Tenant,
    chargingStation: ChargingStation,
    data: { certificateType?: string }
): Promise<OCPPDataTransferResponse> {
    if (!chargingStationClient) {
        await Logging.logError({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
            tenantID: tenant.id,
            module: MODULE_NAME,
            method: 'GetInstalledCertificateIds',
            message: 'La borne de recharge n\'est pas connectée au backend',
        });
        return { status: OCPPDataTransferStatus.REJECTED };
    }

    try {
        // Construire la requête DataTransfer pour OCPP 1.6
        const request: OCPPDataTransferRequest = {
            vendorId: 'org.openchargealliance.iso15118pnc',
            messageId: 'GetInstalledCertificateIds',
            data: JSON.stringify({
                certificateType: data.certificateType || 'V2GRootCertificate', // Chaîne simple, pas un tableau
            }),
        };

        // Envoyer la requête DataTransfer
        const result = await chargingStationClient.dataTransfer(request);

        // Parser la réponse DataTransfer
        let parsedResponse: { status: string; certificateHashData: any[] };
        if (result.status === OCPPDataTransferStatus.ACCEPTED && result.data) {
            const parsedData = JSON.parse(result.data);
            parsedResponse = {
                status: parsedData.status || 'Accepted', // Adapter selon le simulateur
                certificateHashData: parsedData.certificateHashData || [],
            };
        } else {
            parsedResponse = {
                status: 'Rejected',
                certificateHashData: [],
            };
        }

        // Logger le succès
        await Logging.logInfo({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
            tenantID: tenant.id,
            module: MODULE_NAME,
            method: 'GetInstalledCertificateIds',
            message: 'Les identifiants des certificats installés ont été récupérés avec succès',
            detailedMessages: { request, response: result, parsedResponse },
        });

        // Retourner la réponse OCPPDataTransferResponse
        return {
            status: result.status,
            data: JSON.stringify(parsedResponse),
        };
    } catch (error) {
        // Logger l'erreur
        await Logging.logError({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
            tenantID: tenant.id,
            module: MODULE_NAME,
            method: 'GetInstalledCertificateIds',
            message: `Erreur lors de la récupération des identifiants des certificats : ${error.message}`,
            detailedMessages: { error: error.stack },
        });

        return {
            status: OCPPDataTransferStatus.REJECTED,
            data: JSON.stringify({ status: 'Rejected', message: error.message }),
        };
    }
}
  
  private async handleInstallCertificate(tenant: Tenant, chargingStation: ChargingStation, data: any): Promise<OCPPDataTransferResponse> {
  try {
    // Valider les données d'entrée
    if (!data.certificate || !data.certificateType) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleInstallCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate data provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Missing certificate or certificateType' }),
      };
    }

    // Nettoyer le certificat
    const cleanedCertificate = data.certificate.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();

    // Vérifier si le certificat existe déjà
    const existingCertificate = await CertificateStorage.getCertificateByChain(tenant, cleanedCertificate);
    if (existingCertificate) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleInstallCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Certificate already exists for charging station ${chargingStation.id}.`,
        detailedMessages: { data, existingCertificate },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Certificate already exists' }),
      };
    }

    // Vérifier la validité du certificat
    if (!CertificateService.verifyCertificate(cleanedCertificate)) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleInstallCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate' }),
      };
    }

    // Extraire les informations du certificat
    const x509 = new X509Certificate(cleanedCertificate);
    const hashData = CertificateService.extractCertificateHashData(cleanedCertificate);

    // Créer l'objet certificat pour la base de données
    const certificate: Certificate = {
      id: new ObjectId().toString(),
      certificateChain: cleanedCertificate,
      hashData: hashData,
      certificateType: data.certificateType as OCPPGetCertificateIdUseType,
      createdAt: new Date(),
      expiresAt: new Date(x509.validTo),
      status: CertificateStatus.ACTIVE,
      chargingStationID: chargingStation.id,
      tenantID: tenant.id,
      companyID: chargingStation.companyID,
    };

    // Enregistrer le certificat
    await CertificateStorage.saveCertificate(tenant, certificate);

    // Logger le succès
    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleInstallCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Certificat de la borne de recharge ${chargingStation.id} installé dans le backend..`,
      detailedMessages: { data, certificate },
    });

    return {
      status: OCPPDataTransferStatus.ACCEPTED,
      data: JSON.stringify({ status: 'Accepted', message: 'Certificat installé avec succès' }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleInstallCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error installing certificate from charging station to backend.',
      detailedMessages: { error: error.stack, data },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
    };
  }
}


  private async requestInstallCertificate(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,
  data: { certificate?: string; certificateType?: OCPPInstallCertificateUseType } ): Promise<OCPPDataTransferResponse> {
  try {
      if (!data.certificate || !data.certificateType) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'requestInstallCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate data provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Missing certificate or certificateType' }),
      };
    }
const cleanedCertificate = data.certificate.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();
    if (!CertificateService.verifyCertificate(cleanedCertificate)) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'requestInstallCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate' }),
      };
    }

    // Construire la requête DataTransfer
    const request: OCPPInstallCertificateRequest = {
      certificateType: data.certificateType, 
      certificate: cleanedCertificate,
    };

    // Envoyer la requête à la borne
    const response = await chargingStationClient.dataTransfer({
      vendorId: 'org.openchargealliance.iso15118pnc',
      messageId: 'InstallCertificate',
      data: JSON.stringify(request),
    });

    // Logger le résultat
    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestInstallCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Demande d'installation de certificat envoyée à la borne de recharge ${chargingStation.id}.`,
      detailedMessages: { request, response },
    });

    return {
      status: response.status,
      data: response.data || JSON.stringify({
        status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected',
        message: response.status === OCPPDataTransferStatus.ACCEPTED
          ? 'Certificate installed on charging station'
          : 'Failed to install certificate',
      }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestInstallCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error sending certificate installation request to the charging station.',
      detailedMessages: { error: error.stack, data },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
    };
  }
}

  private async requestDeleteCertificate(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,data: data
): Promise<OCPPDataTransferResponse> {
  try {
    if (!data.certificateHashData || !data.certificateHashData.serialNumber) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'requestDeleteCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate hash data provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate hash data' }),
      };
    }
    const request: OCPPDeleteCertificateRequest = {
      certificateHashData: data.certificateHashData as OCPPCertificateHashDataType,
    };
    const response = await chargingStationClient.dataTransfer({
      vendorId: 'org.openchargealliance.iso15118pnc',
      messageId: 'DeleteCertificate',
      data: JSON.stringify(request),
    });

    // Supprimer le certificat si la réponse est ACCEPTED
    if (response.status === OCPPDataTransferStatus.ACCEPTED) {
      const certificateId = await CertificateStorage.findCertificateIdBySerialNumber(
        tenant,
        data.certificateHashData.serialNumber
      );
      if (certificateId) {
        await CertificateStorage.deleteCertificate(tenant, certificateId);
      } else {
        await Logging.logWarning({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'requestDeleteCertificate',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          // message: `Certificate with serial number ${data.certificateHashData.serialNumber} not found for deletion.`,
          message: `Certificat avec le numéro de série  ${data.certificateHashData.serialNumber} a été supprimée avec succès.`,
          detailedMessages: { data },
        });
      }
    }

    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestDeleteCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Certificate deletion request sent to the charging station.',
      detailedMessages: { request, response },
    });

    return {
      status: response.status,
      data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Not Found' }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestDeleteCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error sending certificate deletion request to the charging station.',
      detailedMessages: { error: error.stack },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
    };
  }
}

private async handleDeleteCertificate(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,data: data
): Promise<OCPPDataTransferResponse> {
  try {
    if (!data.certificateHashData || !data.certificateHashData.serialNumber) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleDeleteCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate hash data provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate hash data' }),
      };
    }
    const request: OCPPDeleteCertificateRequest = {
      certificateHashData: data.certificateHashData as OCPPCertificateHashDataType,
    };
    const response = await chargingStationClient.dataTransfer({
      vendorId: 'org.openchargealliance.iso15118pnc',
      messageId: 'DeleteCertificate',
      data: JSON.stringify(request),
    });

    // Supprimer le certificat si la réponse est ACCEPTED
    if (response.status === OCPPDataTransferStatus.ACCEPTED) {
      const certificateId = await CertificateStorage.findCertificateIdBySerialNumber(
        tenant,
        data.certificateHashData.serialNumber
      );
      if (certificateId) {
        await CertificateStorage.deleteCertificate(tenant, certificateId);
      } else {
        await Logging.logWarning({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'requestDeleteCertificate',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: `Certificate with serial number ${data.certificateHashData.serialNumber} not found for deletion.`,
          detailedMessages: { data },
        });
      }
    }

    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleDeleteCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Certificate deletion request sent to the charging station.',
      detailedMessages: { request, response },
    });

    return {
      status: response.status,
      data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Not Found' }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleDeleteCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error sending certificate deletion request to the charging station.',
      detailedMessages: { error: error.stack },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
    };
  }
}

private async handleSignCertificate(
  tenant: Tenant,
  chargingStationClient: ChargingStationClient,
  chargingStation: ChargingStation,
  data: any
): Promise<OCPPDataTransferResponse> {
  try {
    if (!data.csr || typeof data.csr !== 'string') {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleSignCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Missing or invalid CSR.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Missing or invalid CSR' }),
      };
    }

    // Normaliser les sauts de ligne pour gérer les CSR mal échappés
    const normalizedCsr = data.csr.replace(/\\n/g, '\n');

    // Valider le format du CSR
    if (!normalizedCsr.includes('-----BEGIN CERTIFICATE REQUEST-----') || !normalizedCsr.includes('-----END CERTIFICATE REQUEST-----')) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleSignCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid CSR format.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid CSR format' }),
      };
    }

    // Signer le CSR
    const signedCertificate = await CertificateService.signCertificate(tenant, normalizedCsr);

    // Réponse immédiate au SignCertificate
    const signResponse: OCPPDataTransferResponse = {
      status: OCPPDataTransferStatus.ACCEPTED,
      data: JSON.stringify({ status: 'Accepted', certificateChain: signedCertificate }),
    };

    // Envoyer CertificateSigned à la borne
    const certificateSignedRequest = {
      certificateChain: signedCertificate,
    };

    const certificateSignedResponse = await chargingStationClient.dataTransfer({
      vendorId: 'org.openchargealliance.iso15118pnc',
      messageId: 'CertificateSigned',
      data: JSON.stringify(certificateSignedRequest),
    });

    // Enregistrer le certificat dans la base si accepté par la borne
    if (certificateSignedResponse.status === OCPPDataTransferStatus.ACCEPTED) {
      const x509 = new X509Certificate(signedCertificate);
      const hashData = CertificateService.extractCertificateHashData(signedCertificate);

      const certificate: Certificate = {
        id: new ObjectId().toString(),
        certificateChain: signedCertificate,
        hashData: hashData,
        certificateType: data.certificateType || OCPPGetCertificateIdUseType.CHARGING_STATION_CERTIFICATE,
        createdAt: new Date(),
        expiresAt: new Date(x509.validTo),
        status: CertificateStatus.ACTIVE,
        chargingStationID: chargingStation.id,
        tenantID: tenant.id,
        companyID: chargingStation.companyID,
      };

      await CertificateStorage.saveCertificate(tenant, certificate);
    } else {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleSignCertificate',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `CertificateSigned request rejected by charging station: ${certificateSignedResponse.status}`,
        detailedMessages: { certificateSignedResponse },
      });
    }

    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleSignCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Certificat signé et envoyé à la borne. Enregistré avec la borne. ${chargingStation.id}, Locataire ${tenant.id}, Entreprise ${chargingStation.companyID || 'N/A'}`,
      detailedMessages: { data, signedCertificate, certificateSignedResponse },
    });

    return signResponse;
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'handleSignCertificate',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `Error signing certificate: ${error.message}`,
      detailedMessages: { error: error.stack, data },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: `Error signing certificate: ${error.message}` }),
    };
  }
}
private async requestCertificateSigned(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,data: data ): Promise<OCPPDataTransferResponse> {
  try {
    if (!data.certificateChain || typeof data.certificateChain !== 'string') {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'requestCertificateSigned',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid or missing certificate chain provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate chain' }),
      };
    }

    // Nettoyer la chaîne de certificats
    const cleanedCertificateChain = data.certificateChain.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();

    // Vérifier la validité de la chaîne de certificats
    if (!CertificateService.verifyCertificate(cleanedCertificateChain)) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'requestCertificateSigned',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Invalid certificate chain provided.',
        detailedMessages: { data },
      });
      return {
        status: OCPPDataTransferStatus.REJECTED,
        data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate chain' }),
      };
    }

    const request = {
      certificateChain: cleanedCertificateChain,
    };

    const response = await chargingStationClient.dataTransfer({
      vendorId: 'org.openchargealliance.iso15118pnc',
      messageId: 'CertificateSigned',
      data: JSON.stringify(request),
    });

    // Enregistrer le certificat dans la base si accepté par la borne
    if (response.status === OCPPDataTransferStatus.ACCEPTED) {
      const x509 = new X509Certificate(cleanedCertificateChain);
      const hashData = CertificateService.extractCertificateHashData(cleanedCertificateChain);

      const certificate: Certificate = {
        id: new ObjectId().toString(),
        certificateChain: cleanedCertificateChain,
        hashData: hashData,
        certificateType: data.certificateType || 'ChargingStationCertificate', // Utilise certificateType si fourni
        createdAt: new Date(),
        expiresAt: new Date(x509.validTo),
        status: CertificateStatus.ACTIVE,
        chargingStationID: chargingStation.id,
        tenantID: tenant.id,
        companyID: chargingStation.companyID,
      };

      await CertificateStorage.saveCertificate(tenant, certificate);
    }

    await Logging.logInfo({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestCertificateSigned',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: `CertificateSigned request sent to the charging station. Saved with Charging Station ${chargingStation.id}, Tenant ${tenant.id}, Company ${chargingStation.companyID || 'N/A'}`,
      detailedMessages: { request, response },
    });

    return {
      status: response.status,
      data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected' }),
    };
  } catch (error) {
    await Logging.logError({
      ...LoggingHelper.getChargingStationProperties(chargingStation),
      tenantID: tenant.id,
      module: MODULE_NAME,
      method: 'requestCertificateSigned',
      action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
      message: 'Error sending CertificateSigned request to the charging station.',
      detailedMessages: { error: error.stack },
    });
    return {
      status: OCPPDataTransferStatus.REJECTED,
      data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
    };
  }
}
    private async requestTriggerMessage(chargingStationClient: ChargingStationClient, tenant: Tenant, chargingStation: ChargingStation, data: any): Promise<OCPPDataTransferResponse> {
      try {
        const request = {
          requestedMessage: data.requestedMessage || 'CertificateUpdate', // Par défaut, on déclenche une mise à jour de certificat
        };
    
        const response = await chargingStationClient.dataTransfer({
          vendorId: 'org.openchargealliance.iso15118pnc',
          messageId: 'TriggerMessage',
          data: JSON.stringify(request),
        });
    
        await Logging.logInfo({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'requestTriggerMessage',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: 'TriggerMessage request sent to the charging station.',
          detailedMessages: { request, response },
        });
    
        return {
          status: response.status,
          data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected' }),
        };
      } catch (error) {
        await Logging.logError({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'requestTriggerMessage',
          action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
          message: 'Error sending TriggerMessage request to the charging station.',
          detailedMessages: { error: error.stack },
        });
        return {
          status: OCPPDataTransferStatus.REJECTED,
          data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
        };
      }
    }
    
    private async handleGetCertificateStatus(tenant: Tenant, chargingStation: ChargingStation, data: any, headers: OCPPHeader): Promise<OCPPDataTransferResponse> {
      try {
        if (!data.ocspRequestData) {
          throw new Error('Missing ocspRequestData');
        }
    
    
        
      // Log the certificate status request
      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleGetCertificateStatus',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'GetCertificateStatus request received',
        detailedMessages: { data }
      });

     // Ici, vous vérifierez l'état du certificat auprès de GIREVE ou de votre autorité de certification.
    // Pour cet exemple, nous renverrons une réponse fictive.
      const response = {
        status: "Accepted",
        statusInfo: {
          reasonCode: "OK",
          additionalInfo: "Certificate valid"
        },
        ocspResult: "Good" // Certificat valide selon OCSP
      };

      return {
        status: OCPPDataTransferStatus.ACCEPTED,
        data: JSON.stringify(response)
      };
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'handleGetCertificateStatus',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Error handling certificate status: ${error.message}`,
        detailedMessages: { error }
      });
      return { status: OCPPDataTransferStatus.REJECTED };
    }
  }
  public async handleStopTransaction(headers: OCPPHeader, stopTransaction: OCPPStopTransactionRequestExtended,
      isSoftStop = false, isStoppedByCentralSystem = false): Promise<OCPPStopTransactionResponse> {
    try {
      // Get the header infos
      const { chargingStation, tenant } = headers;
      // Check props
      OCPPValidator.getInstance().validateStopTransaction(chargingStation, stopTransaction);
      // Set header
      this.enrichOCPPRequest(chargingStation, stopTransaction, false);
      // Bypass Stop Transaction?
      if (await this.bypassStopTransaction(tenant, chargingStation, stopTransaction)) {
        return {
          idTagInfo: {
            status: OCPPAuthorizationStatus.ACCEPTED
          }
        };
      }
      // Get Transaction
      const transaction = await this.getTransactionFromStopTransaction(tenant, chargingStation, headers, stopTransaction);
      // Get Tag ID that stopped the Transaction
      const tagID = this.getStopTransactionTagId(stopTransaction, transaction);
      // Transaction is stopped by central system?
      const { user, alternateUser } = await this.checkAuthorizeStopTransactionAndGetUsers(
        tenant, chargingStation, transaction, tagID, isStoppedByCentralSystem);
      // Free the connector
      OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, transaction.connectorId);
      // Save Charging Station
      await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
      // Soft Stop
      this.checkSoftStopTransaction(transaction, stopTransaction, isSoftStop);
      // Transaction End has already been received?
      await this.checkAndApplyLastConsumptionInStopTransaction(tenant, chargingStation, transaction, stopTransaction, user);
      // Signed Data
      this.checkAndUpdateTransactionWithSignedDataInStopTransaction(transaction, stopTransaction);
      // Update Transaction with Stop Transaction and Stop MeterValues
      OCPPUtils.updateTransactionWithStopTransaction(transaction, chargingStation, stopTransaction, user, alternateUser, tagID, isSoftStop);
      // Bill
      await BillingFacade.processStopTransaction(tenant, transaction, transaction.user);
      // OCPI
      await OCPIFacade.processStopTransaction(tenant, transaction, chargingStation, chargingStation.siteArea, user, ServerAction.OCPP_STOP_TRANSACTION);
      // OICP
      await OICPFacade.processStopTransaction(tenant, transaction, chargingStation, chargingStation.siteArea, user, ServerAction.OCPP_STOP_TRANSACTION);
      // Save the transaction
      await TransactionStorage.saveTransaction(tenant, transaction);
      // Notify
      NotificationHelper.notifyStopTransaction(tenant, chargingStation, transaction, user, alternateUser);
      // Recompute the Smart Charging Plan
      await this.triggerSmartChargingStopTransaction(tenant, chargingStation, transaction);
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleStopTransaction',
        action: ServerAction.OCPP_STOP_TRANSACTION,
        user: alternateUser ?? (user ?? null),
        actionOnUser: alternateUser ? (user ?? null) : null,
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction has been stopped successfully`,
        detailedMessages: { stopTransaction }
      });
      // Accepted
      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.ACCEPTED
        }
      };
    } catch (error) {
      this.addChargingStationToException(error, headers.chargeBoxIdentity);
      await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.OCPP_STOP_TRANSACTION, error, { stopTransaction });
      // Invalid
      return {
        idTagInfo: {
          status: OCPPAuthorizationStatus.INVALID
        }
      };
    }
  }

  public async softStopTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, siteArea: SiteArea): Promise<void> {
    if (!tenant) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        module: MODULE_NAME, method: 'softStopTransaction',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} The Tenant is mandatory`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        detailedMessages: { transaction, chargingStation, siteArea }
      });
    }
    if (!chargingStation) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        module: MODULE_NAME, method: 'softStopTransaction',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} The Charging Station is mandatory`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        detailedMessages: { transaction, siteArea }
      });
    }
    if (!transaction) {
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'softStopTransaction',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} The Transaction is mandatory`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        detailedMessages: { chargingStation, siteArea }
      });
    }
    if (Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION) && !siteArea) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        module: MODULE_NAME, method: 'softStopTransaction',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} The Site Area is mandatory`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        detailedMessages: { transaction, chargingStation }
      });
    }
    // Set
    chargingStation.siteArea = siteArea;
    // Stop Transaction
    const result = await this.handleStopTransaction(
      { // OCPP Header
        tenant: tenant,
        tenantID: tenant.id,
        chargingStation: chargingStation,
        chargeBoxIdentity: chargingStation.id,
        companyID: transaction.companyID,
        siteID: transaction.siteID,
        siteAreaID: transaction.siteAreaID,
      },
      { // OCPP Stop Transaction
        transactionId: transaction.id,
        chargeBoxID: transaction.chargeBoxID,
        idTag: transaction.tagID,
        timestamp: Utils.convertToDate(transaction.lastConsumption ? transaction.lastConsumption.timestamp : transaction.timestamp).toISOString(),
        meterStop: transaction.lastConsumption ? transaction.lastConsumption.value : transaction.meterStart
      },
      true
    );
    if (result.idTagInfo?.status !== OCPPAuthorizationStatus.ACCEPTED) {
      let authUser: { user: User, alternateUser: User };
      if (transaction.chargeBox) {
        // Transaction is stopped by central system?
        authUser = await this.checkAuthorizeStopTransactionAndGetUsers(
          tenant, transaction.chargeBox, transaction, transaction.tagID, true);
        console.log('Transaction is stopped by central system going to update');
      }
      // Update Transaction with Stop Transaction and Stop MeterValues
      OCPPUtils.updateTransactionWithStopTransaction(transaction, transaction.chargeBox, {
        transactionId: transaction.id,
        chargeBoxID: transaction.chargeBoxID,
        idTag: transaction.tagID,
        timestamp: Utils.convertToDate(transaction.lastConsumption ? transaction.lastConsumption.timestamp : transaction.timestamp).toISOString(),
        meterStop: transaction.lastConsumption ? transaction.lastConsumption.value : transaction.meterStart
      }, authUser?.user, authUser?.alternateUser, transaction.tagID, true);
      // Save the transaction
      await TransactionStorage.saveTransaction(tenant, transaction);
    }
  }

  public async checkAuthorizeStopTransactionAndGetUsers(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction,
      tagID: string, isStoppedByCentralSystem: boolean): Promise<{ user: User; alternateUser: User; }> {
    let user: User;
    let alternateUser: User;
    if (!isStoppedByCentralSystem) {
      // Check and get the authorized Users
      const authorizedUsers = await CommonUtilsService.isAuthorizedToStopTransaction(
        tenant, chargingStation, transaction, tagID, ServerAction.OCPP_STOP_TRANSACTION, Action.STOP_TRANSACTION);
      user = authorizedUsers.user;
      alternateUser = authorizedUsers.alternateUser;
    } else {
      // Get the User
      user = await UserStorage.getUserByTagID(tenant, tagID);
    }
    // Already Stopped?
    if (transaction.stop) {
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'checkAuthorizeStopTransactionAndGetUsers',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction has already been stopped`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        user: (alternateUser ? alternateUser : user),
        actionOnUser: (alternateUser ? user : null),
        detailedMessages: { transaction }
      });
    }
    return { user, alternateUser };
  }

  private checkAndUpdateTransactionWithSignedDataInStopTransaction(transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended) {
    // Handle Signed Data in Stop Transaction
    if (!Utils.isEmptyArray(stopTransaction.transactionData)) {
      for (const meterValue of stopTransaction.transactionData as OCPPMeterValue[]) {
        for (const sampledValue of meterValue.sampledValue) {
          if (sampledValue.format === OCPPValueFormat.SIGNED_DATA) {
            // Set Signed data in Start of Transaction
            if (sampledValue.context === OCPPReadingContext.TRANSACTION_BEGIN) {
              transaction.signedData = sampledValue.value;
            }
            if (sampledValue.context === OCPPReadingContext.TRANSACTION_END) {
              transaction.currentSignedData = sampledValue.value;
            }
          }
        }
      }
    }
  }

  private async triggerSmartChargingStopTransaction(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    if (Utils.isTenantComponentActive(tenant, TenantComponents.SMART_CHARGING)) {
      // Delete TxProfile if any
      await this.deleteAllTransactionTxProfile(tenant, transaction);
      // Call async because the Transaction ID on the connector should be cleared
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      setTimeout(async () => {
        try {
          // Trigger Smart Charging
          await this.triggerSmartCharging(tenant, chargingStation.siteArea);
        } catch (error) {
          await Logging.logError({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            module: MODULE_NAME, method: 'triggerSmartChargingStopTransaction',
            action: ServerAction.OCPP_STOP_TRANSACTION,
            message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Smart Charging exception occurred`,
            detailedMessages: { error: error.stack, transaction, chargingStation }
          });
        }
      }, Constants.DELAY_SMART_CHARGING_EXECUTION_MILLIS);
    }
  }

  private async deleteAllTransactionTxProfile(tenant: Tenant, transaction: Transaction) {
    const chargingProfiles = await ChargingStationStorage.getChargingProfiles(tenant, {
      chargingStationIDs: [transaction.chargeBoxID],
      connectorID: transaction.connectorId,
      profilePurposeType: ChargingProfilePurposeType.TX_PROFILE,
      transactionId: transaction.id
    }, Constants.DB_PARAMS_MAX_LIMIT);
    // Delete all TxProfiles
    for (const chargingProfile of chargingProfiles.result) {
      try {
        await OCPPUtils.clearAndDeleteChargingProfile(tenant, chargingProfile);
        await Logging.logDebug({
          ...LoggingHelper.getTransactionProperties(transaction),
          tenantID: tenant.id,
          action: ServerAction.CHARGING_PROFILE_DELETE,
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} TX Charging Profile with ID '${chargingProfile.id}'`,
          module: MODULE_NAME, method: 'deleteAllTransactionTxProfile',
          detailedMessages: { chargingProfile }
        });
      } catch (error) {
        await Logging.logError({
          ...LoggingHelper.getTransactionProperties(transaction),
          tenantID: tenant.id,
          action: ServerAction.CHARGING_PROFILE_DELETE,
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Cannot delete TX Charging Profile with ID '${chargingProfile.id}'`,
          module: MODULE_NAME, method: 'deleteAllTransactionTxProfile',
          detailedMessages: { error: error.stack, chargingProfile }
        });
      }
    }
  }

  private async processConnectorFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation, statusNotification: OCPPStatusNotificationRequestExtended) {
    // Get Connector
    const { connector, ignoreStatusNotification } =
      await this.checkAndGetConnectorFromStatusNotification(tenant, chargingStation, statusNotification);
    if (!ignoreStatusNotification) {
      // Check last Transaction
      await this.checkAndUpdateLastCompletedTransactionFromStatusNotification(tenant, chargingStation, statusNotification, connector);
      // Keep previous connector status for smart charging
      const previousStatus = connector.status;
      // Update Connector
      connector.connectorId = statusNotification.connectorId;
      connector.status = statusNotification.status;
      connector.errorCode = statusNotification.errorCode;
      connector.info = statusNotification.info;
      connector.vendorErrorCode = statusNotification.vendorErrorCode;
      connector.statusLastChangedOn = new Date(statusNotification.timestamp);
      // Save Status Notification
      await OCPPStorage.saveStatusNotification(tenant, statusNotification);
      // OCPI
      void OCPIFacade.updateConnectorStatus(tenant, chargingStation, connector);
      // OICP
      void OICPFacade.updateConnectorStatus(tenant, chargingStation, connector);
      // Sort connectors
      if (!Utils.isEmptyArray(chargingStation?.connectors)) {
        chargingStation.connectors.sort((connector1: Connector, connector2: Connector) =>
          connector1?.connectorId - connector2?.connectorId);
      }
      // Save Charging Station
      await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
      // Process Smart Charging
      await this.processSmartChargingFromStatusNotification(tenant, chargingStation, connector, previousStatus);
      await Logging.logInfo({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'processConnectorStatusNotification',
        action: ServerAction.OCPP_STATUS_NOTIFICATION,
        message: `${Utils.buildConnectorInfo(statusNotification.connectorId, connector.currentTransactionID)} ${this.buildStatusNotification(statusNotification)} has been saved`,
        detailedMessages: { statusNotification, connector }
      });
      // Notify Users
      await this.notifyStatusNotification(tenant, chargingStation, connector, statusNotification);
    }
  }

  private async processSmartChargingFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation,
      connector: Connector, previousStatus: ChargePointStatus): Promise<void> {
    // Trigger Smart Charging
    if ((connector.status === ChargePointStatus.CHARGING && previousStatus !== ChargePointStatus.SUSPENDED_EVSE) ||
      connector.status === ChargePointStatus.SUSPENDED_EV) {
      try {
        // Trigger Smart Charging
        await this.triggerSmartCharging(tenant, chargingStation.siteArea);
      } catch (error) {
        await Logging.logError({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'processSmartChargingStatusNotification',
          action: ServerAction.OCPP_STATUS_NOTIFICATION,
          message: `${Utils.buildConnectorInfo(connector.connectorId, connector.currentTransactionID)} Smart Charging exception occurred`,
          detailedMessages: { error: error.stack }
        });
      }
    }
  }

  private async checkAndGetConnectorFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation,
      statusNotification: OCPPStatusNotificationRequestExtended): Promise<{ connector: Connector; ignoreStatusNotification: boolean; }> {
    let ignoreStatusNotification = false;
    let connector = Utils.getConnectorFromID(chargingStation, statusNotification.connectorId);
    if (!connector) {
      // Check backup first
      connector = Utils.getLastSeenConnectorFromID(chargingStation, statusNotification.connectorId);
      if (connector) {
        // Append the backup connector
        chargingStation.connectors.push(connector);
        chargingStation.backupConnectors = chargingStation.backupConnectors.filter(
          (backupConnector) => backupConnector.connectorId !== connector.connectorId);
      } else {
        // Does not exist: Create
        connector = {
          currentTransactionID: 0,
          currentTransactionDate: null,
          currentTagID: null,
          currentUserID: null,
          connectorId: statusNotification.connectorId,
          currentInstantWatts: 0,
          status: ChargePointStatus.UNAVAILABLE,
          power: 0,
          type: ConnectorType.UNKNOWN
        };
        chargingStation.connectors.push(connector);
      }
      // Enrich Charging Station's Connector
      await OCPPUtils.enrichChargingStationConnectorWithTemplate(tenant, chargingStation, connector);
      // Same Status Notification?
    } else if (Utils.objectAllPropertiesAreEqual(statusNotification, connector, ['status', 'info', 'errorCode', 'vendorErrorCode'])) {
      ignoreStatusNotification = true;
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        action: ServerAction.OCPP_STATUS_NOTIFICATION,
        module: MODULE_NAME, method: 'handleStatusNotification',
        message: `${this.buildStatusNotification(statusNotification)} has not changed and will be ignored`,
        detailedMessages: { connector, statusNotification }
      });
    }
    return { connector, ignoreStatusNotification };
  }

  private async checkAndUpdateLastCompletedTransactionFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation,
      statusNotification: OCPPStatusNotificationRequestExtended, connector: Connector) {
    // Check last transaction
    if (statusNotification.status === ChargePointStatus.AVAILABLE ||
      statusNotification.status === ChargePointStatus.PREPARING) {
      // Get the last transaction
      const lastTransaction = await TransactionStorage.getLastTransactionFromChargingStation(
        tenant, chargingStation.id, connector.connectorId, { withUser: true });
      if (lastTransaction) {
        try {
          // Transaction completed
          if (lastTransaction.stop) {
            // Check Inactivity
            const transactionUpdated = await this.checkAndComputeTransactionExtraInactivityFromStatusNotification(
              tenant, chargingStation, lastTransaction, lastTransaction.user, connector, statusNotification);
            // Billing: Trigger the asynchronous billing task
            const billingDataUpdated = await this.checkAndBillTransaction(tenant, lastTransaction);
            // OCPI: Post the CDR
            const ocpiUpdated = await OCPIFacade.checkAndSendTransactionCdr(
              tenant, lastTransaction, chargingStation, chargingStation.siteArea, ServerAction.OCPP_STATUS_NOTIFICATION);
            // OICP: Post the CDR
            const oicpUpdated = await OICPFacade.checkAndSendTransactionCdr(
              tenant, lastTransaction, chargingStation, chargingStation.siteArea, ServerAction.OCPP_STATUS_NOTIFICATION);
            // Save
            if (transactionUpdated || billingDataUpdated || ocpiUpdated || oicpUpdated) {
              await TransactionStorage.saveTransaction(tenant, lastTransaction);
            }
          } else {
            await Logging.logWarning({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransactionFromStatusNotification',
              action: ServerAction.OCPP_STATUS_NOTIFICATION,
              message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} Received Status Notification '${statusNotification.status}' while a transaction is ongoing`,
              detailedMessages: { statusNotification }
            });
          }
          // Clear Connector Runtime Data
          OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, lastTransaction.connectorId);
        } catch (error) {
          await Logging.logWarning({
            ...LoggingHelper.getTransactionProperties(lastTransaction),
            tenantID: tenant.id,
            module: MODULE_NAME, method: 'checkAndUpdateLastCompletedTransactionFromStatusNotification',
            action: ServerAction.OCPP_STATUS_NOTIFICATION,
            message: `${Utils.buildConnectorInfo(lastTransaction.connectorId, lastTransaction.id)} Error while trying to update the last Transaction`,
            detailedMessages: { error: error.stack, statusNotification, lastTransaction }
          });
        }
      }
    }
  }

  private async checkAndComputeTransactionExtraInactivityFromStatusNotification(tenant: Tenant, chargingStation: ChargingStation,
      transaction: Transaction, user: User, connector: Connector, statusNotification: OCPPStatusNotificationRequestExtended): Promise<boolean> {
    let extraInactivityUpdated = false;
    if (Utils.objectHasProperty(statusNotification, 'timestamp')) {
      // Session is finished
      if (!transaction.stop.extraInactivityComputed) {
        transaction.stop.extraInactivitySecs = 0;
        // Calculate Extra Inactivity
        if ((connector.status === ChargePointStatus.FINISHING ||
          connector.status === ChargePointStatus.CHARGING ||
          connector.status === ChargePointStatus.SUSPENDED_EV ||
          connector.status === ChargePointStatus.SUSPENDED_EVSE ||
          connector.status === ChargePointStatus.OCCUPIED ||
          connector.status === ChargePointStatus.UNAVAILABLE) &&
          statusNotification.status === ChargePointStatus.AVAILABLE) {
          const transactionStopTimestamp = Utils.convertToDate(transaction.stop.timestamp);
          const currentStatusNotifTimestamp = Utils.convertToDate(statusNotification.timestamp);
          // Diff
          transaction.stop.extraInactivitySecs =
            Utils.createDecimal(currentStatusNotifTimestamp.getTime()).minus(transactionStopTimestamp.getTime()).div(1000).floor().toNumber();
          // Negative inactivity
          if (transaction.stop.extraInactivitySecs < 0) {
            await Logging.logWarning({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              module: MODULE_NAME, method: 'checkAndComputeTransactionExtraInactivityFromStatusNotification',
              action: ServerAction.OCPP_STATUS_NOTIFICATION,
              message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Extra Inactivity is negative and will be ignored: ${transaction.stop.extraInactivitySecs} secs`,
              detailedMessages: { statusNotification }
            });
            transaction.stop.extraInactivitySecs = 0;
          }
          if (transaction.stop.extraInactivitySecs > 0) {
            // Fix the Inactivity severity
            transaction.stop.inactivityStatus = Utils.getInactivityStatusLevel(chargingStation,
              transaction.connectorId,
              transaction.stop.totalInactivitySecs + transaction.stop.extraInactivitySecs
            );
            // Build extra inactivity consumption
            await OCPPUtils.buildAndPriceExtraConsumptionInactivity(tenant, user, chargingStation, transaction);
            await Logging.logInfo({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              user: transaction.userID,
              module: MODULE_NAME, method: 'checkAndComputeTransactionExtraInactivityFromStatusNotification',
              action: ServerAction.EXTRA_INACTIVITY,
              message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Extra Inactivity of ${transaction.stop.extraInactivitySecs} secs has been added`,
              detailedMessages: { statusNotification, connector, lastTransaction: transaction }
            });
          }
        } else {
          // No extra inactivity - connector status is not set to FINISHING
          await Logging.logInfo({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            user: transaction.userID,
            module: MODULE_NAME, method: 'checkAndComputeTransactionExtraInactivityFromStatusNotification',
            action: ServerAction.EXTRA_INACTIVITY,
            message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} No Extra Inactivity for this transaction`,
            detailedMessages: { statusNotification, connector, lastTransaction: transaction }
          });
        }
        // Flag
        transaction.stop.extraInactivityComputed = true;
        extraInactivityUpdated = true;
      }
    }
    return extraInactivityUpdated;
  }

  private async checkAndBillTransaction(tenant: Tenant, transaction: Transaction): Promise<boolean> {
    let transactionUpdated = false;
    // Make sure the Extra Inactivity is already known
    if (transaction.stop?.extraInactivityComputed) {
      transactionUpdated = true;
      // Billing - Start the asynchronous billing flow
      await BillingFacade.processEndTransaction(tenant, transaction, transaction.user);
    }
    return transactionUpdated;
  }

  private async notifyStatusNotification(tenant: Tenant, chargingStation: ChargingStation, connector: Connector, statusNotification: OCPPStatusNotificationRequestExtended) {
    // Faulted?
    if (connector.status !== ChargePointStatus.AVAILABLE &&
      connector.status !== ChargePointStatus.FINISHING && // TODO: To remove after fix of ABB bug having Finishing status with an Error Code to avoid spamming Admins
      connector.errorCode !== ChargePointErrorCode.NO_ERROR) {
      await Logging.logError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        action: ServerAction.OCPP_STATUS_NOTIFICATION,
        module: MODULE_NAME, method: 'notifyStatusNotification',
        message: `${Utils.buildConnectorInfo(connector.connectorId)} Error occurred: ${this.buildStatusNotification(statusNotification)}`
      });
      // Send Notification (Async)
      void NotificationHandler.sendChargingStationStatusError(
        tenant,
        Utils.generateUUID(),
        chargingStation,
        {
          chargeBoxID: chargingStation.id,
          siteID: chargingStation.siteID,
          siteAreaID: chargingStation.siteAreaID,
          companyID: chargingStation.companyID,
          connectorId: Utils.getConnectorLetterFromConnectorID(connector.connectorId),
          error: this.buildStatusNotification(statusNotification),
          evseDashboardURL: Utils.buildEvseURL(tenant.subdomain),
          evseDashboardChargingStationURL: Utils.buildEvseChargingStationURL(tenant.subdomain, chargingStation, '#inerror'),
          tenantPrimaryColor: tenant?.primaryColor
        }
      );
    }
  }

  private updateTransactionWithMeterValues(chargingStation: ChargingStation, transaction: Transaction, meterValues: OCPPNormalizedMeterValue[]) {
    // Build consumptions
    for (const meterValue of meterValues) {
      // To keep backward compatibility with OCPP 1.5 where there is no Transaction.Begin/End,
      // We store the last Transaction.End meter value in transaction to create the last consumption
      // in Stop Transaction
      if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
        // Flag it
        if (!transaction.transactionEndReceived) {
          // First time: clear all values
          transaction.currentInstantWatts = 0;
          transaction.currentInstantWattsL1 = 0;
          transaction.currentInstantWattsL2 = 0;
          transaction.currentInstantWattsL3 = 0;
          transaction.currentInstantWattsDC = 0;
          transaction.currentInstantVolts = 0;
          transaction.currentInstantVoltsL1 = 0;
          transaction.currentInstantVoltsL2 = 0;
          transaction.currentInstantVoltsL3 = 0;
          transaction.currentInstantVoltsDC = 0;
          transaction.currentInstantAmps = 0;
          transaction.currentInstantAmpsL1 = 0;
          transaction.currentInstantAmpsL2 = 0;
          transaction.currentInstantAmpsL3 = 0;
          transaction.currentInstantAmpsDC = 0;
          transaction.transactionEndReceived = true;
        }
      }
      // Signed Data
      if (OCPPUtils.updateSignedData(transaction, meterValue)) {
        continue;
      }
      // SoC
      if (meterValue.attribute.measurand === OCPPMeasurand.STATE_OF_CHARGE) {
        // Set the first SoC and keep it
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_BEGIN) {
          transaction.stateOfCharge = Utils.convertToFloat(meterValue.value);
          continue;
          // Set only the last SoC (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        } else if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          transaction.currentStateOfCharge = Utils.convertToFloat(meterValue.value);
          continue;
        }
      }
      // Voltage
      if (meterValue.attribute.measurand === OCPPMeasurand.VOLTAGE) {
        // Set only the last Voltage (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const voltage = Utils.convertToFloat(meterValue.value);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantVoltsDC = voltage;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1_N:
                case OCPPPhase.L1:
                  transaction.currentInstantVoltsL1 = voltage;
                  break;
                case OCPPPhase.L2_N:
                case OCPPPhase.L2:
                  transaction.currentInstantVoltsL2 = voltage;
                  break;
                case OCPPPhase.L3_N:
                case OCPPPhase.L3:
                  transaction.currentInstantVoltsL3 = voltage;
                  break;
                case OCPPPhase.L1_L2:
                case OCPPPhase.L2_L3:
                case OCPPPhase.L3_L1:
                  // Do nothing
                  break;
                default:
                  transaction.currentInstantVolts = voltage;
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Power
      if (meterValue.attribute.measurand === OCPPMeasurand.POWER_ACTIVE_IMPORT) {
        // Set only the last Power (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const powerInMeterValue = Utils.convertToFloat(meterValue.value);
          const powerInMeterValueWatts = (meterValue.attribute && meterValue.attribute.unit === OCPPUnitOfMeasure.KILO_WATT ?
            powerInMeterValue * 1000 : powerInMeterValue);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantWattsDC = powerInMeterValueWatts;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1_N:
                case OCPPPhase.L1:
                  transaction.currentInstantWattsL1 = powerInMeterValueWatts;
                  break;
                case OCPPPhase.L2_N:
                case OCPPPhase.L2:
                  transaction.currentInstantWattsL2 = powerInMeterValueWatts;
                  break;
                case OCPPPhase.L3_N:
                case OCPPPhase.L3:
                  transaction.currentInstantWattsL3 = powerInMeterValueWatts;
                  break;
                default:
                  transaction.currentInstantWatts = powerInMeterValueWatts;
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Current
      if (meterValue.attribute.measurand === OCPPMeasurand.CURRENT_IMPORT) {
        // Set only the last Current (will be used in the last consumption building in StopTransaction due to backward compat with OCPP 1.5)
        if (meterValue.attribute.context === OCPPReadingContext.TRANSACTION_END) {
          const amperage = Utils.convertToFloat(meterValue.value);
          const currentType = Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId);
          // AC Charging Station
          switch (currentType) {
            case CurrentType.DC:
              transaction.currentInstantAmpsDC = amperage;
              break;
            case CurrentType.AC:
              switch (meterValue.attribute.phase) {
                case OCPPPhase.L1:
                  transaction.currentInstantAmpsL1 = amperage;
                  break;
                case OCPPPhase.L2:
                  transaction.currentInstantAmpsL2 = amperage;
                  break;
                case OCPPPhase.L3:
                  transaction.currentInstantAmpsL3 = amperage;
                  break;
                default:
                  // MeterValue Current.Import is per phase and consumption currentInstantAmps attribute expect the total amperage
                  transaction.currentInstantAmps = amperage * Utils.getNumberOfConnectedPhases(chargingStation, null, transaction.connectorId);
                  break;
              }
              break;
          }
          continue;
        }
      }
      // Consumption
      if (OCPPUtils.isEnergyActiveImportMeterValue(meterValue)) {
        transaction.numberOfMeterValues++;
      }
    }
  }

  private async checkNotificationEndOfCharge(tenant: Tenant, chargingStation: ChargingStation, transaction: Transaction) {
    // Transaction in progress?
    if (!transaction?.stop && transaction.currentTotalConsumptionWh > 0) {
      // Check the battery
      if (transaction.currentStateOfCharge > 0) {
        // Check if battery is full (100%)
        if (transaction.currentStateOfCharge === 100) {
          // Send Notification
          NotificationHelper.notifyEndOfCharge(tenant, chargingStation, transaction);
          // Check if optimal charge has been reached (85%)
        } else if (transaction.currentStateOfCharge >= this.chargingStationConfig.notifBeforeEndOfChargePercent) {
          // Send Notification
          NotificationHelper.notifyOptimalChargeReached(tenant, chargingStation, transaction);
        }
        // No battery information: check last consumptions
      } else {
        // Connector' status must be 'Suspended'
        const connector = Utils.getConnectorFromID(chargingStation, transaction.connectorId);
        if (connector.status === ChargePointStatus.SUSPENDED_EVSE ||
          connector.status === ChargePointStatus.SUSPENDED_EV) {
          // Check the last 3 consumptions
          const consumptions = await ConsumptionStorage.getTransactionConsumptions(
            tenant, { transactionId: transaction.id }, { limit: 3, skip: 0, sort: { startedAt: -1 } });
          if (consumptions.count === 3) {
            // Check the consumptions
            const noConsumption = consumptions.result.every((consumption) =>
              consumption.consumptionWh === 0 &&
              (consumption.limitSource !== ConnectorCurrentLimitSource.CHARGING_PROFILE ||
                consumption.limitAmps >= StaticLimitAmps.MIN_LIMIT_PER_PHASE * Utils.getNumberOfConnectedPhases(chargingStation, null, transaction.connectorId)));
            // Send Notification
            if (noConsumption) {
              NotificationHelper.notifyEndOfCharge(tenant, chargingStation, transaction);
            }
          }
        }
      }
    }
  }

  private filterMeterValuesOnSpecificChargingStations(tenant: Tenant, chargingStation: ChargingStation, meterValues: OCPPNormalizedMeterValues) {
    // Clean up Sample.Clock meter value
    if (chargingStation.chargePointVendor !== ChargerVendor.ABB ||
      chargingStation.ocppVersion !== OCPPVersion.VERSION_15) {
      // Filter Sample.Clock meter value for all chargers except ABB using OCPP 1.5
      meterValues.values = meterValues.values.filter(async (meterValue) => {
        // Remove Sample Clock
        if (meterValue.attribute && meterValue.attribute.context === OCPPReadingContext.SAMPLE_CLOCK) {
          await Logging.logWarning({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            module: MODULE_NAME, method: 'filterMeterValuesOnSpecificChargingStations',
            action: ServerAction.OCPP_METER_VALUES,
            message: `Removed Meter Value with attribute context '${OCPPReadingContext.SAMPLE_CLOCK}'`,
            detailedMessages: { meterValue }
          });
          return false;
        }
        return true;
      });
    }
  }

  private normalizeMeterValues(chargingStation: ChargingStation, meterValues: OCPPMeterValuesRequestExtended): OCPPNormalizedMeterValues {
    // Create the normalized meter value
    const normalizedMeterValues: OCPPNormalizedMeterValues = {
      chargeBoxID: chargingStation.id,
      siteID: chargingStation.siteID,
      siteAreaID: chargingStation.siteAreaID,
      companyID: chargingStation.companyID,
      values: []
    };
    // OCPP 1.5: transfer to OCPP 1.6 structure
    if (chargingStation.ocppVersion === OCPPVersion.VERSION_15) {
      meterValues.meterValue = meterValues.values;
      delete meterValues.values;
    }
    // Always convert to an Array
    if (!Array.isArray(meterValues.meterValue)) {
      meterValues.meterValue = [meterValues.meterValue];
    }
    // Process the Meter Values
    for (const meterValue of meterValues.meterValue) {
      const normalizedMeterValue = {
        chargeBoxID: chargingStation.id,
        connectorId: meterValues.connectorId,
        transactionId: meterValues.transactionId,
        timestamp: Utils.convertToDate(meterValue.timestamp),
      } as OCPPNormalizedMeterValue;
      // OCPP 1.6
      if (chargingStation.ocppVersion === OCPPVersion.VERSION_16) {
        // Always an Array
        if (!Array.isArray(meterValue.sampledValue)) {
          meterValue.sampledValue = [meterValue.sampledValue];
        }
        // Create one record per value
        for (const sampledValue of meterValue.sampledValue) {
          // Add Attributes
          const normalizedLocalMeterValue: OCPPNormalizedMeterValue = Utils.cloneObject(normalizedMeterValue);
          normalizedLocalMeterValue.attribute = this.buildMeterValueAttributes(sampledValue);
          // Data is to be interpreted as integer/decimal numeric data
          if (normalizedLocalMeterValue.attribute.format === OCPPValueFormat.RAW) {
            normalizedLocalMeterValue.value = Utils.convertToFloat(sampledValue.value);
            // Data is represented as a signed binary data block, encoded as hex data
          } else if (normalizedLocalMeterValue.attribute.format === OCPPValueFormat.SIGNED_DATA) {
            normalizedLocalMeterValue.value = sampledValue.value;
          }
          // Add
          normalizedMeterValues.values.push(normalizedLocalMeterValue);
        }
        // OCPP 1.5
      } else if (meterValue['value']) {
        if (Array.isArray(meterValue['value'])) {
          for (const currentValue of meterValue['value']) {
            normalizedMeterValue.value = Utils.convertToFloat(currentValue['$value']);
            normalizedMeterValue.attribute = currentValue.attributes;
            normalizedMeterValues.values.push(Utils.cloneObject(normalizedMeterValue));
          }
        } else {
          normalizedMeterValue.value = Utils.convertToFloat(meterValue['value']['$value']);
          normalizedMeterValue.attribute = meterValue['value'].attributes;
          normalizedMeterValues.values.push(Utils.cloneObject(normalizedMeterValue));
        }
      }
    }
    return normalizedMeterValues;
  }

  private buildMeterValueAttributes(sampledValue: OCPPSampledValue): OCPPAttribute {
    return {
      context: sampledValue.context ? sampledValue.context : OCPPReadingContext.SAMPLE_PERIODIC,
      format: sampledValue.format ? sampledValue.format : OCPPValueFormat.RAW,
      measurand: sampledValue.measurand ? sampledValue.measurand : OCPPMeasurand.ENERGY_ACTIVE_IMPORT_REGISTER,
      location: sampledValue.location ? sampledValue.location : OCPPLocation.OUTLET,
      unit: sampledValue.unit ? sampledValue.unit : OCPPUnitOfMeasure.WATT_HOUR,
      phase: sampledValue.phase ? sampledValue.phase : null
    };
  }

  private async processExistingTransaction(tenant: Tenant, chargingStation: ChargingStation, connectorId: number) {
    let activeTransaction: Transaction, lastCheckedTransactionID: number;
    do {
      // Check if the charging station has already a transaction
      activeTransaction = await TransactionStorage.getActiveTransaction(tenant, chargingStation.id, connectorId);
      // Exists already?
      if (activeTransaction) {
        // Avoid infinite Loop
        if (lastCheckedTransactionID === activeTransaction.id) {
          return;
        }
        // Has consumption?
        if (activeTransaction.currentTotalConsumptionWh <= 0) {
          // No consumption: delete
          await Logging.logWarning({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
            action: ServerAction.CLEANUP_TRANSACTION,
            actionOnUser: activeTransaction.user,
            message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)} Transaction with no consumption has been deleted`
          });
          // Delete
          await TransactionStorage.deleteTransaction(tenant, activeTransaction.id);
          // Clear connector
          OCPPUtils.clearChargingStationConnectorRuntimeData(chargingStation, activeTransaction.connectorId);
        } else {
          // Simulate a Stop Transaction
          const result = await this.handleStopTransaction({
            tenantID: tenant.id,
            chargeBoxIdentity: activeTransaction.chargeBoxID,
            companyID: activeTransaction.companyID,
            siteID: activeTransaction.siteID,
            siteAreaID: activeTransaction.siteAreaID,
          }, {
            chargeBoxID: activeTransaction.chargeBoxID,
            transactionId: activeTransaction.id,
            meterStop: (activeTransaction.lastConsumption ? activeTransaction.lastConsumption.value : activeTransaction.meterStart),
            timestamp: Utils.convertToDate(activeTransaction.lastConsumption ? activeTransaction.lastConsumption.timestamp : activeTransaction.timestamp).toISOString(),
          }, false, true);
          if (result.idTagInfo.status === OCPPAuthorizationStatus.INVALID) {
            // Cannot stop it
            await Logging.logError({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
              action: ServerAction.CLEANUP_TRANSACTION,
              actionOnUser: activeTransaction.userID,
              message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)} Pending transaction cannot be stopped`,
              detailedMessages: { result }
            });
          } else {
            // Stopped
            await Logging.logWarning({
              ...LoggingHelper.getChargingStationProperties(chargingStation),
              tenantID: tenant.id,
              module: MODULE_NAME, method: 'stopOrDeleteActiveTransactions',
              action: ServerAction.CLEANUP_TRANSACTION,
              actionOnUser: activeTransaction.userID,
              message: `${Utils.buildConnectorInfo(activeTransaction.connectorId, activeTransaction.id)}  Pending transaction has been stopped`,
              detailedMessages: { result }
            });
          }
        }
        // Keep last Transaction ID
        lastCheckedTransactionID = activeTransaction.id;
      }
    } while (activeTransaction);
  }

  private getStopTransactionTagId(stopTransaction: OCPPStopTransactionRequestExtended, transaction: Transaction): string {
    // Stopped Remotely?
    if (transaction.remotestop) {
      // Yes: Get the diff from now
      const secs = moment.duration(moment().diff(
        moment(transaction.remotestop.timestamp))).asSeconds();
      // In a minute
      if (secs < 60) {
        // Return tag that remotely stopped the transaction
        return transaction.remotestop.tagID;
      }
    }
    // Already provided?
    if (stopTransaction.idTag) {
      // Return tag that stopped the transaction
      return stopTransaction.idTag;
    }
    // Default: return tag that started the transaction
    return transaction.tagID;
  }

  private async triggerSmartCharging(tenant: Tenant, siteArea: SiteArea) {
    // Smart Charging must be active
    if (Utils.isTenantComponentActive(tenant, TenantComponents.SMART_CHARGING)) {
      // Get Site Area
      if (siteArea && siteArea.smartCharging) {
        const siteAreaLock = await LockingHelper.acquireSiteAreaSmartChargingLock(tenant.id, siteArea);
        if (siteAreaLock) {
          try {
            const smartCharging = await SmartChargingFactory.getSmartChargingImpl(tenant);
            if (smartCharging) {
              await smartCharging.computeAndApplyChargingProfiles(siteArea);
            }
          } finally {
            // Release lock
            await LockingManager.release(siteAreaLock);
          }
        }
      }
    }
  }

  private async processTransactionCar(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation, consumption: Consumption, user: User,
      action: TransactionAction): Promise<void> {
    let soc = null;
    switch (action) {
      case TransactionAction.START:
        // Handle car in transaction start
        if (Utils.isTenantComponentActive(tenant, TenantComponents.CAR) && user) {
          // Check Car from User selection (valid for 5 mins)
          if (user.startTransactionData?.lastSelectedCar &&
            user.startTransactionData.lastChangedOn?.getTime() + 5 * 60 * 1000 > Date.now()) {
            transaction.carID = user.startTransactionData.lastSelectedCarID;
            transaction.carStateOfCharge = user.startTransactionData.lastCarStateOfCharge;
            transaction.carOdometer = user.startTransactionData.lastCarOdometer;
            transaction.departureTime = user.startTransactionData.lastDepartureTime;
            transaction.targetStateOfCharge = user.startTransactionData.lastTargetStateOfCharge;
          } else {
            // Get default car if any
            const defaultCar = await CarStorage.getDefaultUserCar(tenant, user.id, {},
              ['id', 'carCatalogID', 'vin', 'carConnectorData.carConnectorID', 'carConnectorData.carConnectorMeterID']);
            if (defaultCar) {
              transaction.carID = defaultCar.id;
              transaction.carCatalogID = defaultCar.carCatalogID;
              transaction.car = defaultCar;
            }
          }
          // Set Car Catalog ID
          if (transaction.carID && !transaction.carCatalogID) {
            const car = await CarStorage.getCar(tenant, transaction.carID, {},
              ['id', 'carCatalogID', 'vin', 'carConnectorData.carConnectorID', 'carConnectorData.carConnectorMeterID']);
            transaction.carCatalogID = car?.carCatalogID;
            transaction.car = car;
          }
          // Clear
          await UserStorage.saveStartTransactionData(tenant, user.id, {
            lastChangedOn: null,
            lastSelectedCarID: null,
            lastSelectedCar: false,
            lastCarStateOfCharge: null,
            lastCarOdometer: null,
            lastDepartureTime: null,
            lastTargetStateOfCharge: null
          });
          // Handle SoC
          soc = await this.getCurrentSoc(tenant, transaction, chargingStation);
          if (soc) {
            transaction.stateOfCharge = soc;
          }
        }
        break;
      case TransactionAction.UPDATE:
        // Handle SoC
        if (Utils.isNullOrUndefined(transaction.car) || Utils.isNullOrUndefined(consumption)) {
          return;
        }
        // Reassignment not needed anymore with specific connector data in car object --> Coming with Tronity implementation
        transaction.car.carCatalog = transaction.carCatalog;
        soc = await this.getCurrentSoc(tenant, transaction, chargingStation);
        if (soc) {
          consumption.stateOfCharge = soc;
        }
        break;
    }
  }

  private async getCurrentSoc(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation): Promise<number> {
    if (Utils.isTenantComponentActive(tenant, TenantComponents.CAR_CONNECTOR) && !Utils.isNullOrUndefined(transaction.car) &&
      !Utils.isNullOrUndefined(transaction.car.carConnectorData?.carConnectorID) &&
      Utils.getChargingStationCurrentType(chargingStation, null, transaction.connectorId) === CurrentType.AC) {
      const carImplementation = await CarConnectorFactory.getCarConnectorImpl(tenant, transaction.car.carConnectorData.carConnectorID);
      if (carImplementation) {
        try {
          return await carImplementation.getCurrentSoC(transaction.car, transaction.userID);
          // eslint-disable-next-line no-empty
        } catch {
        }
      }
    }
  }

  private addChargingStationToException(error: BackendError, chargingStationID: string): void {
    if (error.params) {
      error.params.source = chargingStationID;
    }
  }

  private enrichStartTransaction(tenant: Tenant, startTransaction: OCPPStartTransactionRequestExtended, chargingStation: ChargingStation): void {
    // Enrich
    this.enrichOCPPRequest(chargingStation, startTransaction, false);
    startTransaction.tagID = startTransaction.idTag;
    // Organization
    if (Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION)) {
      // Set the Organization IDs
      startTransaction.companyID = chargingStation.companyID;
      startTransaction.siteID = chargingStation.siteID;
      startTransaction.siteAreaID = chargingStation.siteAreaID;
    }
  }

  private async createTransaction(tenant: Tenant, startTransaction: OCPPStartTransactionRequestExtended): Promise<Transaction> {
    return {
      id: await TransactionStorage.findAvailableID(tenant),
      issuer: true,
      chargeBoxID: startTransaction.chargeBoxID,
      tagID: startTransaction.idTag,
      timezone: startTransaction.timezone,
      userID: startTransaction.userID,
      companyID: startTransaction.companyID,
      siteID: startTransaction.siteID,
      siteAreaID: startTransaction.siteAreaID,
      connectorId: startTransaction.connectorId,
      meterStart: startTransaction.meterStart,
      timestamp: Utils.convertToDate(startTransaction.timestamp),
      numberOfMeterValues: 0,
      lastConsumption: {
        value: startTransaction.meterStart,
        timestamp: Utils.convertToDate(startTransaction.timestamp)
      },
      currentInstantWatts: 0,
      currentStateOfCharge: 0,
      currentConsumptionWh: 0,
      currentTotalConsumptionWh: 0,
      currentTotalInactivitySecs: 0,
      currentInactivityStatus: InactivityStatus.INFO,
      signedData: '',
      stateOfCharge: 0,
    };
  }

  private getHeartbeatInterval(ocppProtocol: OCPPProtocol): number {
    switch (ocppProtocol) {
      case OCPPProtocol.SOAP:
        return this.chargingStationConfig.heartbeatIntervalOCPPSSecs;
      case OCPPProtocol.JSON:
        return this.chargingStationConfig.heartbeatIntervalOCPPJSecs;
    }
  }

  private enrichBootNotification(headers: OCPPHeader, bootNotification: OCPPBootNotificationRequestExtended): void {
    // Set the endpoint
    if (headers.From) {
      bootNotification.endpoint = headers.From.Address;
    }
    bootNotification.id = headers.chargeBoxIdentity;
    bootNotification.chargeBoxID = headers.chargeBoxIdentity;
    bootNotification.currentIPAddress = headers.currentIPAddress;
    bootNotification.ocppProtocol = headers.ocppProtocol;
    bootNotification.ocppVersion = headers.ocppVersion;
    bootNotification.timestamp = new Date();
  }

  private async createChargingStationFromBootNotification(tenant: Tenant,
      bootNotification: OCPPBootNotificationRequestExtended, headers: OCPPHeader): Promise<ChargingStation> {
    // New Charging Station: Create (Token has already been checked and provided!)
    const newChargingStation = {} as ChargingStation;
    for (const key in bootNotification) {
      newChargingStation[key] = bootNotification[key];
    }
    // Update props
    newChargingStation.createdOn = new Date();
    newChargingStation.issuer = true;
    newChargingStation.tokenID = headers.tokenID;
    newChargingStation.powerLimitUnit = ChargingRateUnitType.AMPERE;
    // Assign to Site Area
    if (headers.token.siteAreaID) {
      const siteArea = await SiteAreaStorage.getSiteArea(tenant, headers.token.siteAreaID, { withSite: true });
      if (siteArea) {
        newChargingStation.companyID = siteArea.site?.companyID;
        newChargingStation.siteID = siteArea.siteID;
        newChargingStation.siteAreaID = headers.token.siteAreaID;
        // Set coordinates
        if (siteArea.address?.coordinates?.length === 2) {
          newChargingStation.coordinates = siteArea.address.coordinates;
          // Backup on Site's coordinates
        } else if (siteArea.site?.address?.coordinates?.length === 2) {
          newChargingStation.coordinates = siteArea.site.address.coordinates;
        }
      }
    }
    return newChargingStation;
  }

  private checkChargingStationIsIdenticalFromBootNotification(chargingStation: ChargingStation, bootNotification: OCPPBootNotificationRequestExtended) {
    // Existing Charging Station: Update
    // Check if same vendor and model
    if ((chargingStation.chargePointVendor !== bootNotification.chargePointVendor ||
      chargingStation.chargePointModel !== bootNotification.chargePointModel) ||
      (chargingStation.chargePointSerialNumber && bootNotification.chargePointSerialNumber &&
        chargingStation.chargePointSerialNumber !== bootNotification.chargePointSerialNumber)) {
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        action: ServerAction.OCPP_BOOT_NOTIFICATION,
        module: MODULE_NAME, method: 'checkExistingChargingStation',
        message: 'Boot Notification Rejected: Attribute mismatch: ' +
          (bootNotification.chargePointVendor !== chargingStation.chargePointVendor ?
            `Got chargePointVendor='${bootNotification.chargePointVendor}' but expected '${chargingStation.chargePointVendor}'! ` : '') +
          (bootNotification.chargePointModel !== chargingStation.chargePointModel ?
            `Got chargePointModel='${bootNotification.chargePointModel}' but expected '${chargingStation.chargePointModel}'! ` : '') +
          (bootNotification.chargePointSerialNumber !== chargingStation.chargePointSerialNumber ?
            `Got chargePointSerialNumber='${bootNotification.chargePointSerialNumber ? bootNotification.chargePointSerialNumber : ''}' but expected '${chargingStation.chargePointSerialNumber ? chargingStation.chargePointSerialNumber : ''}'!` : ''),
        detailedMessages: { bootNotification }
      });
    }
  }

  private async enrichChargingStationFromBootNotification(tenant: Tenant, chargingStation: ChargingStation, headers: OCPPHeader,
      bootNotification: OCPPBootNotificationRequestExtended) {
    // Set common params
    chargingStation.ocppProtocol = bootNotification.ocppProtocol;
    chargingStation.ocppVersion = bootNotification.ocppVersion;
    chargingStation.currentIPAddress = bootNotification.currentIPAddress;
    chargingStation.cloudHostIP = Utils.getHostIP();
    chargingStation.cloudHostName = Utils.getHostName();
    chargingStation.lastReboot = bootNotification.timestamp;
    chargingStation.lastSeen = bootNotification.timestamp;
    chargingStation.chargePointSerialNumber = bootNotification.chargePointSerialNumber;
    chargingStation.chargeBoxSerialNumber = bootNotification.chargeBoxSerialNumber;
    chargingStation.firmwareVersion = bootNotification.firmwareVersion;
    chargingStation.deleted = false;
    // Set the Charging Station URL?
    if (headers.chargingStationURL) {
      chargingStation.chargingStationURL = headers.chargingStationURL;
    }
    // Clear Firmware Status
    if (chargingStation.firmwareUpdateStatus) {
      // Clear status
      await ChargingStationStorage.saveChargingStationFirmwareStatus(tenant, chargingStation.id, null);
      // Force reapply Template
      delete chargingStation.templateHash;
      delete chargingStation.templateHashCapabilities;
      delete chargingStation.templateHashOcppStandard;
      delete chargingStation.templateHashOcppVendor;
      delete chargingStation.templateHashTechnical;
    }
    // Backup connectors
    if (!Utils.isEmptyArray(chargingStation.connectors)) {
      // Init array
      if (Utils.isEmptyArray(chargingStation.backupConnectors)) {
        chargingStation.backupConnectors = [];
      }
      // Check and backup connectors
      for (const connector of chargingStation.connectors) {
        // Check if already backed up
        const foundBackupConnector = chargingStation.backupConnectors.find(
          (backupConnector) => backupConnector.connectorId === connector.connectorId);
        if (!foundBackupConnector) {
          chargingStation.backupConnectors.push(connector);
        }
      }
    }
    // Clear Connectors
    chargingStation.connectors = [];
  }

  private notifyBootNotification(tenant: Tenant, chargingStation: ChargingStation) {
    void NotificationHandler.sendChargingStationRegistered(
      tenant,
      Utils.generateUUID(),
      chargingStation,
      {
        chargeBoxID: chargingStation.id,
        siteID: chargingStation.siteID,
        siteAreaID: chargingStation.siteAreaID,
        companyID: chargingStation.companyID,
        evseDashboardURL: Utils.buildEvseURL(tenant.subdomain),
        evseDashboardChargingStationURL: Utils.buildEvseChargingStationURL(tenant.subdomain, chargingStation, '#all'),
        tenantPrimaryColor: tenant?.primaryColor
      }
    );
  }

  private enrichAuthorize(user: User, chargingStation: ChargingStation, headers: OCPPHeader, authorize: OCPPAuthorizeRequestExtended) {
    // Enrich
    this.enrichOCPPRequest(chargingStation, authorize);
    // Roaming User
    if (user && !user.issuer && chargingStation.siteArea.accessControl) {
      // Authorization ID provided?
      if (user.authorizationID) {
        // Public Charging Station
        if (chargingStation.public) {
          // Keep Roaming Auth ID
          authorize.authorizationId = user.authorizationID;
        } else {
          throw new BackendError({
            user: user,
            action: ServerAction.OCPP_AUTHORIZE,
            module: MODULE_NAME,
            method: 'enrichAuthorize',
            message: 'Cannot authorize a roaming user on a private charging station',
            detailedMessages: { authorize }
          });
        }
      } else {
        throw new BackendError({
          user: user,
          action: ServerAction.OCPP_AUTHORIZE,
          module: MODULE_NAME,
          method: 'enrichAuthorize',
          message: 'Authorization ID has not been supplied',
          detailedMessages: { authorize }
        });
      }
    }
    // Set
    authorize.user = user;
  }

  private enrichOCPPRequest(chargingStation: ChargingStation, ocppRequest: any, withTimeStamp = true) {
    // Enrich Request
    ocppRequest.chargeBoxID = chargingStation.id;
    ocppRequest.timezone = Utils.getTimezone(chargingStation.coordinates);
    if (withTimeStamp && !ocppRequest.timestamp) {
      ocppRequest.timestamp = new Date();
    }
  }

  private async bypassStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      stopTransaction: OCPPStopTransactionRequestExtended): Promise<boolean> {
    // Ignore it (DELTA bug)?
    if (stopTransaction.transactionId === 0) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'bypassStopTransaction',
        action: ServerAction.OCPP_STOP_TRANSACTION,
        message: 'Ignored Transaction ID = 0',
        detailedMessages: { stopTransaction }
      });
      return true;
    }
    return false;
  }

  private async getTransactionFromMeterValues(tenant: Tenant, chargingStation: ChargingStation, headers: OCPPHeader, meterValues: OCPPMeterValuesRequest): Promise<Transaction> {
    // Handle Meter Value only for transaction
    if (!meterValues.transactionId) {
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId)} Meter Values are not linked to a transaction and will be ignored`,
        action: ServerAction.OCPP_METER_VALUES,
        detailedMessages: { meterValues }
      });
    }
    const transaction = await TransactionStorage.getTransaction(
      tenant, meterValues.transactionId, { withUser: true, withTag: true, withCar: true });
    if (!transaction) {
      // Abort the ongoing Transaction
      if (meterValues.transactionId) {
        await this.abortOngoingTransactionInMeterValues(tenant, chargingStation, meterValues);
      }
      // Unkown Transaction
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Transaction does not exist`,
        action: ServerAction.OCPP_METER_VALUES,
        detailedMessages: { meterValues }
      });
    }
    // Transaction finished
    if (transaction?.stop) {
      // Abort the ongoing Transaction
      await this.abortOngoingTransactionInMeterValues(tenant, chargingStation, meterValues);
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Transaction has already been stopped`,
        action: ServerAction.OCPP_METER_VALUES,
        detailedMessages: { transaction, meterValues }
      });
    }
    // Received Meter Values after the Transaction End Meter Value
    if (transaction.transactionEndReceived) {
      await Logging.logWarning({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'getTransactionFromMeterValues',
        action: ServerAction.OCPP_METER_VALUES,
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Meter Values received after the 'Transaction.End'`,
        detailedMessages: { meterValues }
      });
    }
    return transaction;
  }

  private async abortOngoingTransactionInMeterValues(tenant: Tenant, chargingStation: ChargingStation, meterValues: OCPPMeterValuesRequest) {
    // Get the OCPP Client
    const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
    if (!chargingStationClient) {
      await Logging.logError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'abortOngoingTransactionInMeterValues',
        action: ServerAction.OCPP_METER_VALUES,
        message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Charging Station is not connected to the backend, cannot send a Remote Stop Transaction on an ongoing Transaction`,
        detailedMessages: { meterValues }
      });
    } else {
      // Send Remote Stop
      const result = await chargingStationClient.remoteStopTransaction({
        transactionId: meterValues.transactionId
      });
      if (result.status === OCPPRemoteStartStopStatus.ACCEPTED) {
        await Logging.logWarning({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'abortOngoingTransactionInMeterValues',
          action: ServerAction.OCPP_METER_VALUES,
          message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Transaction has been automatically remotely stopped`,
          detailedMessages: { meterValues }
        });
      } else {
        await Logging.logError({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'abortOngoingTransactionInMeterValues',
          action: ServerAction.OCPP_METER_VALUES,
          message: `${Utils.buildConnectorInfo(meterValues.connectorId, meterValues.transactionId)} Cannot send a Remote Stop Transaction on an unknown ongoing Transaction`,
          detailedMessages: { meterValues }
        });
      }
    }
  }

  private async getTransactionFromStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      headers: OCPPHeader, stopTransaction: OCPPStopTransactionRequestExtended): Promise<Transaction> {
    const transaction = await TransactionStorage.getTransaction(tenant, stopTransaction.transactionId, { withUser: true, withTag: true });
    if (!transaction) {
      throw new BackendError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        module: MODULE_NAME, method: 'getTransactionFromStopTransaction',
        message: `Transaction with ID '${stopTransaction.transactionId}' doesn't exist`,
        action: ServerAction.OCPP_STOP_TRANSACTION,
        detailedMessages: { stopTransaction }
      });
    }
    return transaction;
  }

  private checkSoftStopTransaction(transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended, isSoftStop: boolean) {
    if (isSoftStop) {
      // Yes: Add the latest Meter Value
      if (transaction.lastConsumption) {
        stopTransaction.meterStop = transaction.lastConsumption.value;
      } else {
        stopTransaction.meterStop = 0;
      }
    }
  }

  private async checkAndApplyLastConsumptionInStopTransaction(tenant: Tenant, chargingStation: ChargingStation,
      transaction: Transaction, stopTransaction: OCPPStopTransactionRequestExtended, user: User) {
    // No need to compute the last consumption if Transaction.End Meter Value has been received
    if (!transaction.transactionEndReceived) {
      // Recreate the last meter value to price the last Consumption
      const stopMeterValues = OCPPUtils.createTransactionStopMeterValues(chargingStation, transaction, stopTransaction);
      // Build final Consumptions (only one consumption)
      const consumptions = await OCPPUtils.createConsumptionsFromMeterValues(tenant, chargingStation, transaction, stopMeterValues);
      // Update
      for (const consumption of consumptions) {
        // Update Transaction with Consumption
        OCPPUtils.updateTransactionWithConsumption(chargingStation, transaction, consumption);
        if (consumption.toPrice) {
          // Price
          await PricingFacade.processStopTransaction(tenant, transaction, chargingStation, consumption, user);
        }
        // Save Consumption
        await ConsumptionStorage.saveConsumption(tenant, consumption);
      }
      // Check Inactivity and Consumption between the last Transaction.End and Stop Transaction
    } else if (transaction.lastConsumption) {
      // The consumption should be the same
      if (transaction.lastConsumption.value !== stopTransaction.meterStop) {
        await Logging.logWarning({
          ...LoggingHelper.getChargingStationProperties(chargingStation),
          tenantID: tenant.id,
          action: ServerAction.OCPP_STOP_TRANSACTION,
          actionOnUser: user,
          module: MODULE_NAME, method: 'checkAndApplyLastConsumptionInStopTransaction',
          message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Transaction.End consumption '${transaction.lastConsumption.value}' differs from Stop Transaction '${stopTransaction.meterStop}'`,
          detailedMessages: { stopTransaction, transaction }
        });
      }
      // Handle inactivity
      const inactivitySecs = Utils.createDecimal(new Date(stopTransaction.timestamp).getTime() - new Date(transaction.lastConsumption.timestamp).getTime()).div(1000).toNumber();
      // Add inactivity to Transaction
      if (inactivitySecs > 0) {
        transaction.currentTotalInactivitySecs += inactivitySecs;
        transaction.currentTotalDurationSecs += inactivitySecs;
      }
    }
  }

  private buildStatusNotification(statusNotification: OCPPStatusNotificationRequestExtended) {
    const statusNotifications: string[] = [];
    statusNotifications.push(`Status: '${statusNotification.status}'`);
    if (statusNotification.errorCode && statusNotification.errorCode !== 'NoError') {
      statusNotifications.push(`errorCode: '${statusNotification.errorCode}'`);
    }
    if (statusNotification.info) {
      statusNotifications.push(`info: '${statusNotification.info}'`);
    }
    if (statusNotification.vendorErrorCode) {
      statusNotifications.push(`vendorErrorCode: '${statusNotification.vendorErrorCode}'`);
    }
    if (statusNotification.vendorId) {
      statusNotifications.push(`vendorId: '${statusNotification.vendorId}'`);
    }
    return statusNotifications.join(', ');
  }



}


// public async handleDataTransfer(headers: OCPPHeader, dataTransfer: OCPPDataTransferRequestExtended): Promise<OCPPDataTransferResponse> {
//   console.log('Message DataTransfer reçu du simulateur :', JSON.stringify(dataTransfer, null, 2));
//   try {
//     const { chargingStation, tenant } = headers;

//     // Valider les données de la requête
//     OCPPValidator.getInstance().validateDataTransfer(chargingStation, dataTransfer);

//     // Enrichir la requête avec des informations supplémentaires
//     this.enrichOCPPRequest(chargingStation, dataTransfer);

//     // Vérifier si le message est lié à ISO 15118
//     if (dataTransfer.vendorId === 'org.openchargealliance.iso15118pnc') {
//       const data = dataTransfer.data && dataTransfer.data !== '' ? JSON.parse(dataTransfer.data) : {};

//       // Obtenir le client pour communiquer avec la borne
//       const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
//       if (!chargingStationClient) {
//         throw new Error('Charging Station client not available');
//       }

//       let response: OCPPDataTransferResponse;
//       switch (dataTransfer.messageId) {
//         case 'Authorize':
//           response = await this.handleISO15118Authorize(tenant, chargingStation, data, headers);
//           break;

//         case 'GetInstalledCertificateIds':
//           response = await this.handleGetInstalledCertificateIds(chargingStationClient, tenant, chargingStation, data);
//           break;

//         case 'InstallCertificate':
//           response = await this.requestInstallCertificate(chargingStationClient, tenant, chargingStation, data);
//           break;

//         case 'DeleteCertificate':
//           response = await this.requestDeleteCertificate(chargingStationClient, tenant, chargingStation, data);
//           break;

//         case 'SignCertificate':
//           response = await this.handleSignCertificate(tenant, chargingStationClient, chargingStation, data);
//           break;

//         case 'CertificateSigned':
//           response = await this.requestCertificateSigned(chargingStationClient, tenant, chargingStation, data);
//           break;
//         case 'TriggerMessage': 
//           response = await this.requestTriggerMessage(chargingStationClient, tenant, chargingStation, data);
//           break;
//         case 'GetCertificateStatus': 
//           response = await this.handleGetCertificateStatus(tenant, chargingStation, data, headers);
//           break;
        
        

//         default:
//           await Logging.logWarning({
//             ...LoggingHelper.getChargingStationProperties(chargingStation),
//             tenantID: tenant.id,
//             module: MODULE_NAME,
//             method: 'handleDataTransfer',
//             action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//             message: `Unsupported ISO 15118 message: ${dataTransfer.messageId}`,
//             detailedMessages: { dataTransfer },
//           });
//           response = { status: OCPPDataTransferStatus.REJECTED };
//           break;
//       }

//       // Sauvegarder la requête et logger uniquement si le traitement a réussi
//       if (response.status === OCPPDataTransferStatus.ACCEPTED) {
//         await OCPPStorage.saveDataTransfer(tenant, dataTransfer);
//         await Logging.logInfo({
//           ...LoggingHelper.getChargingStationProperties(chargingStation),
//           tenantID: tenant.id,
//           module: MODULE_NAME,
//           method: 'handleDataTransfer',
//           action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//           message: 'Data Transfer has been processed successfully',
//           detailedMessages: { dataTransfer, response },
//         });
//       }

//       return response;
//     }

//     // Si ce n'est pas un message ISO 15118, retourner ACCEPTED par défaut
//     return { status: OCPPDataTransferStatus.ACCEPTED };
//   } catch (error) {
//     this.addChargingStationToException(error, headers.chargeBoxIdentity);
//     await Logging.logActionExceptionMessage(headers.tenantID, ServerAction.CHARGING_STATION_DATA_TRANSFER, error, { dataTransfer });
//     return { status: OCPPDataTransferStatus.REJECTED };
//   }
// }

// private async handleISO15118Authorize(tenant: Tenant, chargingStation: ChargingStation, data: any, headers: OCPPHeader): Promise<OCPPDataTransferResponse> {
//   try {
//     console.log("Données reçues pour ISO 15118 :", JSON.stringify(data, null, 2));

//     // Clean the certificate chain
//     data.certificateChain = data.certificateChain.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();

//     // Validate certificate-related input data
//     if (!data?.iso15118CertificateHashData?.[0] || !data?.certificateChain) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'handleISO15118Authorize',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Invalid ISO 15118 certificate data provided.',
//         detailedMessages: { data },
//       });
//       return {
//         status: OCPPDataTransferStatus.REJECTED,
//         data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
//       };
//     }

//     // Verify the ISO 15118 certificate
//     const isValid = CertificateService.verifyCertificate(data.certificateChain, data.iso15118CertificateHashData[0]);
//     console.log('Certificate verification result:', isValid);
//     if (!isValid) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'handleISO15118Authorize',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Invalid ISO 15118 certificate provided.',
//         detailedMessages: { data },
//       });
//       console.log('Returning REJECTED due to invalid certificate');
//       return {
//         status: OCPPDataTransferStatus.REJECTED,
//         data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
//       };
//     }

//     // Check if idToken is present in the data object
//     if (!data.idToken) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'handleISO15118Authorize',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Missing idToken in ISO 15118 authorization request.',
//         detailedMessages: { data },
//       });
//       console.log('Returning REJECTED due to missing idToken');
//       return {
//         status: OCPPDataTransferStatus.REJECTED,
//         data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
//       };
//     }

//     // Vérifier si l'idToken existe dans la base de données comme emaid
//     const emaid = await EmaidStorage.getEmaid(tenant, data.idToken);
//     if (!emaid) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'handleISO15118Authorize',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: `idToken '${data.idToken}' not found in emaids database.`,
//         detailedMessages: { data },
//       });
//       console.log('Returning REJECTED due to idToken not found in database');
//       return {
//         status: OCPPDataTransferStatus.REJECTED,
//         data: JSON.stringify({ idTokenInfo: { status: OCPPAuthorizationStatus.INVALID } }),
//       };
//     }

//     // Authentication successful (idToken exists in database, certificate valid)
//     await Logging.logInfo({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'handleISO15118Authorize',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: `User authenticated via ISO 15118 Plug & Charge with idToken '${data.idToken}'`,
//       detailedMessages: { data, emaid },
//     });

//     console.log('idToken found in database:', data.idToken);

//     // Déclencher RemoteStartTransaction si l'autorisation est valide
//     if (isValid && emaid) {
//       const chargingStationClient = await ChargingStationClientFactory.getChargingStationClient(tenant, chargingStation);
//       if (chargingStationClient) {
//         await chargingStationClient.remoteStartTransaction({
//           connectorId: 1, // À ajuster dynamiquement selon la borne
//           idTag: data.idToken, // Utilise l'idToken validé
//         });
//         await Logging.logInfo({
//           ...LoggingHelper.getChargingStationProperties(chargingStation),
//           tenantID: tenant.id,
//           module: MODULE_NAME,
//           method: 'handleISO15118Authorize',
//           action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//           message: `RemoteStartTransaction triggered for connector 1 with idToken '${data.idToken}'.`,
//         });
//       } else {
//         await Logging.logWarning({
//           ...LoggingHelper.getChargingStationProperties(chargingStation),
//           tenantID: tenant.id,
//           module: MODULE_NAME,
//           method: 'handleISO15118Authorize',
//           action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//           message: 'Charging station client not available, unable to trigger RemoteStartTransaction.',
//         });
//       }
//     }

//     console.log('Returning ACCEPTED');
//     return {
//       status: OCPPDataTransferStatus.ACCEPTED,
//       data: JSON.stringify({
//         idTokenInfo: { status: OCPPAuthorizationStatus.ACCEPTED },
//         certificateStatus: 'Accepted' 
//       }),
//     };
//   } catch (error) {
//     await Logging.logError({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'handleISO15118Authorize',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Error during ISO 15118 authorization.',
//       detailedMessages: { error: error.stack },
//     });
//     return { status: OCPPDataTransferStatus.REJECTED };
//   }
// }
// private async handleGetInstalledCertificateIds(
//   chargingStationClient: ChargingStationClient,
//   tenant: Tenant,
//   chargingStation: ChargingStation,
//   data: { certificateType?: string }
// ): Promise<OCPPDataTransferResponse> {
//   if (!chargingStationClient) {
//     await Logging.logError({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'GetInstalledCertificateIds',
//       message: 'Charging Station is not connected to the backend',
//     });
//     return { status: OCPPDataTransferStatus.REJECTED };
//   }

//   try {
//     // Construct the DataTransfer request
//     const request: OCPPDataTransferRequest = {
//       vendorId: 'org.openchargealliance.iso15118pnc',
//       messageId: 'GetInstalledCertificateIds',
//       data: JSON.stringify({
//         certificateType: data.certificateType || 'V2GRootCertificate',
//       }),
//     };

//     // Send the DataTransfer request
//     const result = await chargingStationClient.dataTransfer(request);

//     // Parse the DataTransfer response
//     let parsedResponse: GetInstalledCertificateIdsResponse;
//     if (result.status === OCPPDataTransferStatus.ACCEPTED && result.data) {
//       const parsedData = JSON.parse(result.data);
//       parsedResponse = {
//         status: parsedData.status || GetInstalledCertificateStatusEnum.ACCEPTED,
//         certificateHashData: parsedData.certificateHashData || [],
//       };
//     } else {
//       parsedResponse = {
//         status: GetInstalledCertificateStatusEnum.REJECTED, 
//         certificateHashData: [],
//       };
//     }

//     // Log success
//     await Logging.logInfo({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'GetInstalledCertificateIds',
//       message: 'Successfully retrieved installed certificate IDs',
//       detailedMessages: { request, response: result, parsedResponse },
//     });

//     // Return OCPPDataTransferResponse
//     return {
//       status: result.status,
//       data: JSON.stringify(parsedResponse),
//     };
//   } catch (error) {
//     // Log error
//     await Logging.logError({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'GetInstalledCertificateIds',
//       message: `Error retrieving installed certificate IDs: ${error.message}`,
//       detailedMessages: { error: error.stack },
//     });

//     return {
//       status: OCPPDataTransferStatus.REJECTED,
//     };
//   }
// }

// private async requestInstallCertificate(chargingStationClient:ChargingStationClient ,tenant: Tenant,chargingStation: ChargingStation,data: data ): Promise<OCPPDataTransferResponse> {
//   try {
//     // Validation des données d'entrée
//     if (!data.certificate || !data.certificateType) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'requestInstallCertificate',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Invalid certificate data provided.',
//         detailedMessages: { data },
//       });
//       return { status: OCPPDataTransferStatus.REJECTED };
//     }

//     // Nettoyer le certificat
//     const cleanedCertificate = data.certificate.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();

//     // Vérifier la validité du certificat avant de l'envoyer à la borne
//     if (!CertificateService.verifyCertificate(cleanedCertificate)) {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'requestInstallCertificate',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Invalid certificate provided.',
//         detailedMessages: { data },
//       });
//       return { status: OCPPDataTransferStatus.REJECTED };
//     }

//     const request: OCPPInstallCertificateRequest = {
//       certificateType: data.certificateType as OCPPInstallCertificateUseType,
//       certificate: cleanedCertificate,
//     };

//     const response = await chargingStationClient.dataTransfer({
//       vendorId: 'org.openchargealliance.iso15118pnc',
//       messageId: 'InstallCertificate',
//       data: JSON.stringify(request),
//     });

//     // Enregistrer le certificat si la réponse est ACCEPTED
//     if (response.status === OCPPDataTransferStatus.ACCEPTED) {
//       // Extraire les informations du certificat
//       const x509 = new X509Certificate(cleanedCertificate);
//       const hashData = CertificateService.extractCertificateHashData(cleanedCertificate);

//       const certificate: Certificate = {
//         id: new ObjectId().toString(),// Génère un ID unique
//         certificateChain: cleanedCertificate,
//         hashData: hashData,
//         certificateType: data.certificateType as OCPPGetCertificateIdUseType,
//         createdAt: new Date(),
//         expiresAt: new Date(x509.validTo), // Récupérer la date d'expiration directement
//         status: CertificateStatus.ACTIVE,
//         chargingStationID: chargingStation.id, 
//         tenantID: tenant.id, 
//         companyID: chargingStation.companyID,
//         //organization: hashData.organization || '-',
        
//       };
//       await CertificateStorage.saveCertificate(tenant, certificate);
//     }

//     await Logging.logInfo({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'requestInstallCertificate',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Certificate installation request sent to the charging station.',
//       detailedMessages: { request, response },
//     });

//     return {
//       status: response.status,
//       data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected' }),
//     };
//   } catch (error) {
//     await Logging.logError({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'requestInstallCertificate',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Error sending certificate installation request to the charging station.',
//       detailedMessages: { error: error.stack },
//     });
//     return { status: OCPPDataTransferStatus.REJECTED };
//   }
// }

// private async requestDeleteCertificate(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,data: data
// ): Promise<OCPPDataTransferResponse> {
// try {
//   // Validation des données d'entrée
//   if (!data.certificateHashData || !data.certificateHashData.serialNumber) {
//     await Logging.logWarning({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'requestDeleteCertificate',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Invalid certificate hash data provided.',
//       detailedMessages: { data },
//     });
//     return {
//       status: OCPPDataTransferStatus.REJECTED,
//       data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate hash data' }),
//     };
//   }

//   const request: OCPPDeleteCertificateRequest = {
//     certificateHashData: data.certificateHashData as OCPPCertificateHashDataType,
//   };

//   const response = await chargingStationClient.dataTransfer({
//     vendorId: 'org.openchargealliance.iso15118pnc',
//     messageId: 'DeleteCertificate',
//     data: JSON.stringify(request),
//   });

//   // Supprimer le certificat si la réponse est ACCEPTED
//   if (response.status === OCPPDataTransferStatus.ACCEPTED) {
//     const certificateId = await CertificateStorage.findCertificateIdBySerialNumber(
//       tenant,
//       data.certificateHashData.serialNumber
//     );
//     if (certificateId) {
//       await CertificateStorage.deleteCertificate(tenant, certificateId);
//     } else {
//       await Logging.logWarning({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'requestDeleteCertificate',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: `Certificate with serial number ${data.certificateHashData.serialNumber} not found for deletion.`,
//         detailedMessages: { data },
//       });
//     }
//   }

//   await Logging.logInfo({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'requestDeleteCertificate',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: 'Certificate deletion request sent to the charging station.',
//     detailedMessages: { request, response },
//   });

//   return {
//     status: response.status,
//     data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Not Found' }),
//   };
// } catch (error) {
//   await Logging.logError({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'requestDeleteCertificate',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: 'Error sending certificate deletion request to the charging station.',
//     detailedMessages: { error: error.stack },
//   });
//   return {
//     status: OCPPDataTransferStatus.REJECTED,
//     data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
//   };
// }
// }
// private async handleSignCertificate(tenant: Tenant,chargingStationClient: ChargingStationClient,chargingStation: ChargingStation,data: data 
// ): Promise<OCPPDataTransferResponse> {
// try {
//   if (!data.csr || typeof data.csr !== 'string') {
//     await Logging.logWarning({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'handleSignCertificate',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Missing or invalid CSR.',
//       detailedMessages: { data },
//     });
//     return {
//       status: OCPPDataTransferStatus.REJECTED,
//       data: JSON.stringify({ status: 'Rejected' }),
//     };
//   }

//   // Signer le CSR
//   const signedCertificate = await CertificateService.signCertificate(tenant, data.csr);


//   // Réponse immédiate au SignCertificate
//   const signResponse: OCPPDataTransferResponse = {
//     status: OCPPDataTransferStatus.ACCEPTED,
//     data: JSON.stringify({ status: 'Accepted' }),
//   };

//   // Envoyer CertificateSigned à la borne
//   const certificateSignedRequest = {certificateChain: signedCertificate,

//   };

//   const certificateSignedResponse = await chargingStationClient.dataTransfer({
//     vendorId: 'org.openchargealliance.iso15118pnc',
//     messageId: 'CertificateSigned',
//     data: JSON.stringify(certificateSignedRequest),
//   });

//   // Enregistrer le certificat dans la base si accepté par la borne
//   if (certificateSignedResponse.status === OCPPDataTransferStatus.ACCEPTED) {
//     const x509 = new X509Certificate(signedCertificate);
//     const hashData = CertificateService.extractCertificateHashData(signedCertificate);

//     const certificate: Certificate = {
//       id: new ObjectId().toString(),
//       certificateChain: signedCertificate,
//       hashData: hashData,
//       certificateType: data.certificateType || OCPPGetCertificateIdUseType.CHARGING_STATION_CERTIFICATE, // Utilisation de l'enum
//       createdAt: new Date(),
//       expiresAt: new Date(x509.validTo),
//       status: CertificateStatus.ACTIVE,
//       chargingStationID: chargingStation.id,
//       tenantID: tenant.id,
//       companyID: chargingStation.companyID,
//     };

//     await CertificateStorage.saveCertificate(tenant, certificate);
//   }

//   await Logging.logInfo({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'handleSignCertificate',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: `Certificate signed and CertificateSigned sent to the charging station. Saved with Charging Station ${chargingStation.id}, Tenant ${tenant.id}, Company ${chargingStation.companyID || 'N/A'}`,
//     detailedMessages: { data, signedCertificate, certificateSignedResponse },
//   });

//   return signResponse;
// } catch (error) {
//   await Logging.logError({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'handleSignCertificate',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: 'Error signing certificate.',
//     detailedMessages: { error: error.stack, data },
//   });
//   return {
//     status: OCPPDataTransferStatus.REJECTED,
//     data: JSON.stringify({ status: 'Rejected' }),
//   };
// }
// }
// private async requestCertificateSigned(chargingStationClient: ChargingStationClient,tenant: Tenant,chargingStation: ChargingStation,data: data ): Promise<OCPPDataTransferResponse> {
// try {
//   if (!data.certificateChain || typeof data.certificateChain !== 'string') {
//     await Logging.logWarning({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'requestCertificateSigned',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Invalid or missing certificate chain provided.',
//       detailedMessages: { data },
//     });
//     return {
//       status: OCPPDataTransferStatus.REJECTED,
//       data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate chain' }),
//     };
//   }

//   // Nettoyer la chaîne de certificats
//   const cleanedCertificateChain = data.certificateChain.replace(/\\n/g, '\n').replace(/\r\n|\r|\n/g, '\n').trim();

//   // Vérifier la validité de la chaîne de certificats
//   if (!CertificateService.verifyCertificate(cleanedCertificateChain)) {
//     await Logging.logWarning({
//       ...LoggingHelper.getChargingStationProperties(chargingStation),
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'requestCertificateSigned',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'Invalid certificate chain provided.',
//       detailedMessages: { data },
//     });
//     return {
//       status: OCPPDataTransferStatus.REJECTED,
//       data: JSON.stringify({ status: 'Rejected', message: 'Invalid certificate chain' }),
//     };
//   }

//   const request = {
//     certificateChain: cleanedCertificateChain,
//   };

//   const response = await chargingStationClient.dataTransfer({
//     vendorId: 'org.openchargealliance.iso15118pnc',
//     messageId: 'CertificateSigned',
//     data: JSON.stringify(request),
//   });

//   // Enregistrer le certificat dans la base si accepté par la borne
//   if (response.status === OCPPDataTransferStatus.ACCEPTED) {
//     const x509 = new X509Certificate(cleanedCertificateChain);
//     const hashData = CertificateService.extractCertificateHashData(cleanedCertificateChain);

//     const certificate: Certificate = {
//       id: new ObjectId().toString(),
//       certificateChain: cleanedCertificateChain,
//       hashData: hashData,
//       certificateType: data.certificateType || 'ChargingStationCertificate', // Utilise certificateType si fourni
//       createdAt: new Date(),
//       expiresAt: new Date(x509.validTo),
//       status: CertificateStatus.ACTIVE,
//       chargingStationID: chargingStation.id,
//       tenantID: tenant.id,
//       companyID: chargingStation.companyID,
//     };

//     await CertificateStorage.saveCertificate(tenant, certificate);
//   }

//   await Logging.logInfo({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'requestCertificateSigned',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: `CertificateSigned request sent to the charging station. Saved with Charging Station ${chargingStation.id}, Tenant ${tenant.id}, Company ${chargingStation.companyID || 'N/A'}`,
//     detailedMessages: { request, response },
//   });

//   return {
//     status: response.status,
//     data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected' }),
//   };
// } catch (error) {
//   await Logging.logError({
//     ...LoggingHelper.getChargingStationProperties(chargingStation),
//     tenantID: tenant.id,
//     module: MODULE_NAME,
//     method: 'requestCertificateSigned',
//     action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//     message: 'Error sending CertificateSigned request to the charging station.',
//     detailedMessages: { error: error.stack },
//   });
//   return {
//     status: OCPPDataTransferStatus.REJECTED,
//     data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
//   };
// }
// }
//   private async requestTriggerMessage(chargingStationClient: ChargingStationClient, tenant: Tenant, chargingStation: ChargingStation, data: any): Promise<OCPPDataTransferResponse> {
//     try {
//       const request = {
//         requestedMessage: data.requestedMessage || 'CertificateUpdate', // Par défaut, on déclenche une mise à jour de certificat
//       };
  
//       const response = await chargingStationClient.dataTransfer({
//         vendorId: 'org.openchargealliance.iso15118pnc',
//         messageId: 'TriggerMessage',
//         data: JSON.stringify(request),
//       });
  
//       await Logging.logInfo({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'requestTriggerMessage',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'TriggerMessage request sent to the charging station.',
//         detailedMessages: { request, response },
//       });
  
//       return {
//         status: response.status,
//         data: response.data || JSON.stringify({ status: response.status === OCPPDataTransferStatus.ACCEPTED ? 'Accepted' : 'Rejected' }),
//       };
//     } catch (error) {
//       await Logging.logError({
//         ...LoggingHelper.getChargingStationProperties(chargingStation),
//         tenantID: tenant.id,
//         module: MODULE_NAME,
//         method: 'requestTriggerMessage',
//         action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//         message: 'Error sending TriggerMessage request to the charging station.',
//         detailedMessages: { error: error.stack },
//       });
//       return {
//         status: OCPPDataTransferStatus.REJECTED,
//         data: JSON.stringify({ status: 'Rejected', message: 'Internal server error' }),
//       };
//     }
//   }
  
//   private async handleGetCertificateStatus(tenant: Tenant, chargingStation: ChargingStation, data: any, headers: OCPPHeader): Promise<OCPPDataTransferResponse> {
//     try {
//       if (!data.ocspRequestData) {
//         throw new Error('Missing ocspRequestData');
//       }
  
  
      
//     // Log the certificate status request
//     await Logging.logInfo({
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'handleGetCertificateStatus',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: 'GetCertificateStatus request received',
//       detailedMessages: { data }
//     });

//    // Ici, vous vérifierez l'état du certificat auprès de GIREVE ou de votre autorité de certification.
//   // Pour cet exemple, nous renverrons une réponse fictive.
//     const response = {
//       status: "Accepted",
//       statusInfo: {
//         reasonCode: "OK",
//         additionalInfo: "Certificate valid"
//       },
//       ocspResult: "Good" // Certificat valide selon OCSP
//     };

//     return {
//       status: OCPPDataTransferStatus.ACCEPTED,
//       data: JSON.stringify(response)
//     };
//   } catch (error) {
//     await Logging.logError({
//       tenantID: tenant.id,
//       module: MODULE_NAME,
//       method: 'handleGetCertificateStatus',
//       action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
//       message: `Error handling certificate status: ${error.message}`,
//       detailedMessages: { error }
//     });
//     return { status: OCPPDataTransferStatus.REJECTED };
//   }
// }