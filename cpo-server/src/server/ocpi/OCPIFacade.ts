/* eslint-disable prefer-const */
import ChargingStation, { Connector } from '../../types/ChargingStation';
import Tenant, { TenantComponents } from '../../types/Tenant';

import BackendError from '../../exception/BackendError';
import CpoOCPIClient from '../../client/ocpi/CpoOCPIClient';
import LockingHelper from '../../locking/LockingHelper';
import LockingManager from '../../locking/LockingManager';
import Logging from '../../utils/Logging';
import LoggingHelper from '../../utils/LoggingHelper';
import OCPIClientFactory from '../../client/ocpi/OCPIClientFactory';
import { OCPIRole } from '../../types/ocpi/OCPIRole';
import { ServerAction } from '../../types/Server';
import SiteArea from '../../types/SiteArea';
import Tag from '../../types/Tag';
import TenantStorage from '../../storage/mongodb/TenantStorage';
import Transaction from '../../types/Transaction';
import User from '../../types/User';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'OCPIFacade';

export default class OCPIFacade {
  public static async processStartTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation,
      siteArea: SiteArea, tag: Tag, user: User, action: ServerAction): Promise<void> {

    // If tenant is child get parentTenant
    let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

    if (!Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) ||
      !chargingStation.issuer || !chargingStation.public || !siteArea.accessControl || user.issuer) {
      return;
    }
    // Get OCPI CPO client
    const ocpiClient = await OCPIFacade.checkAndGetOcpiCpoClient(parentTenant, transaction, user, action);
    // Check Authorization
    if (!transaction.authorizationID) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        action: action,
        module: MODULE_NAME, method: 'processStartTransaction',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Tag ID '${transaction.tagID}' is not authorized`
      });
    }
    await ocpiClient.startSession(tag.ocpiToken, chargingStation, transaction, tenant);
  }

  public static async processUpdateTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation,
      siteArea: SiteArea, user: User, action: ServerAction): Promise<void> {

    // If tenant is child get parentTenant
    let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

    if (!Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) ||
      !chargingStation.issuer || !chargingStation.public || !siteArea.accessControl || user.issuer) {
      return;
    }
    try {
      // Get OCPI CPO client
      const ocpiClient = await OCPIFacade.checkAndGetOcpiCpoClient(parentTenant, transaction, user, action);
      // Update OCPI Session
      await ocpiClient.updateSession(transaction, tenant);
    } catch (error) {
      await Logging.logWarning({
        ...LoggingHelper.getTransactionProperties(transaction),
        tenantID: parentTenant.id,
        action, module: MODULE_NAME, method: 'processUpdateTransaction',
        user: transaction.userID,
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} Cannot process OCPI Update Transaction: ${error.message as string}`,
        detailedMessages: { error: error.stack }
      });
    }
  }

  public static async processStopTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation,
      siteArea: SiteArea, user: User, action: ServerAction): Promise<void> {

    // If tenant is child get parentTenant
    let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

    if (!Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) ||
      !chargingStation.issuer || !chargingStation.public || !siteArea.accessControl || user.issuer) {
      return;
    }
    // Get OCPI CPO client
    const ocpiClient = await OCPIFacade.checkAndGetOcpiCpoClient(parentTenant, transaction, user, action);
    // Stop OCPI Session
    await ocpiClient.stopSession(transaction, tenant);
  }

  public static async processEndTransaction(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation,
      siteArea: SiteArea, user: User, action: ServerAction): Promise<boolean> {
    // If tenant is child get parentTenant
    let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

    if (!Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) ||
      !chargingStation.issuer || !chargingStation.public || !siteArea.accessControl || user.issuer) {
      return false ;
    }
    // Get OCPI CPO client
    const ocpiClient = await OCPIFacade.checkAndGetOcpiCpoClient(parentTenant, transaction, user, action);
    return await ocpiClient.postCdr(transaction, tenant);
  }

  public static async checkAndSendTransactionCdr(tenant: Tenant, transaction: Transaction,
      chargingStation: ChargingStation, siteArea: SiteArea, action: ServerAction): Promise<boolean> {
    // If tenant is child get parentTenant
    let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

    // CDR not already pushed
    if (Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) &&
      transaction.ocpiData?.session && !transaction.ocpiData.cdr?.id) {
      // Get the lock
      const ocpiLock = await LockingHelper.acquireOCPIPushCdrLock(parentTenant.id, transaction.id);
      if (ocpiLock) {
        try {
          // Roaming
          return OCPIFacade.processEndTransaction(
            tenant, transaction, chargingStation, siteArea, transaction.user, action);
        } finally {
          // Release the lock
          await LockingManager.release(ocpiLock);
        }
      }
    }
  }

  public static async updateConnectorStatus(tenant: Tenant, chargingStation: ChargingStation, connector: Connector): Promise<void> {
    try {
      // If tenant is child get parentTenant
      let parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);

      if (Utils.isTenantComponentActive(parentTenant, TenantComponents.OCPI) &&
        chargingStation.issuer && chargingStation.public) {
        const ocpiClient = await OCPIClientFactory.getAvailableOcpiClient(parentTenant, OCPIRole.CPO) as CpoOCPIClient;
        // Patch status
        if (ocpiClient) {
          await ocpiClient.patchChargingStationConnectorStatus(chargingStation, connector);
        }
      }
    } catch (error) {
      console.log('updateConnectorStatus error:', error.message);

      await Logging.logError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'updateConnectorStatus',
        action: ServerAction.OCPI_CPO_UPDATE_STATUS,
        message: `${Utils.buildConnectorInfo(connector.connectorId)} An error occurred while patching the connector's Status`,
        detailedMessages: { error: error.stack, connector, chargingStation }
      });
    }
  }

  private static async checkAndGetOcpiCpoClient(tenant: Tenant, transaction: Transaction,
      user: User, action: ServerAction): Promise<CpoOCPIClient> {
    // Check User
    if (!user) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        action, module: MODULE_NAME, method: 'checkAndGetOcpiCpoClient',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} User is mandatory`
      });
    }

    if (user.issuer) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        action, module: MODULE_NAME, method: 'checkAndGetOcpiCpoClient',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} User does not belong to the local organization`
      });
    }

    console.log('--------------------------------transaction.tag.ocpiToken.issuer',transaction.tag.ocpiToken.issuer);
    const ocpiClient = await OCPIClientFactory.getAvailableOcpiClientModified(tenant, OCPIRole.CPO,transaction.tag.ocpiToken.issuer) as CpoOCPIClient;

    if (!ocpiClient) {
      throw new BackendError({
        ...LoggingHelper.getTransactionProperties(transaction),
        action, module: MODULE_NAME, method: 'checkAndGetOcpiCpoClient',
        message: `${Utils.buildConnectorInfo(transaction.connectorId, transaction.id)} OCPI component requires at least one CPO endpoint to start a Transaction`
      });
    }
    return ocpiClient;
  }
}
