import Tenant, { TenantComponents } from '../../types/Tenant';
import BillingFactory from '../../integration/billing/BillingFactory';
import { BillingDataTransactionStop } from '../../types/Billing';
import { ChargePointStatus } from '../../types/ocpp/OCPPServer';
import LockingHelper from '../../locking/LockingHelper';
import LockingManager from '../../locking/LockingManager';
import Logging from '../../utils/Logging';
import { ServerAction } from '../../types/Server';
import TenantSchedulerTask from '../TenantSchedulerTask';
import TransactionStorage from '../../storage/mongodb/TransactionStorage';
import Utils from '../../utils/Utils';
import global from '../../types/GlobalType';
import BillingStorage from '../../storage/mongodb/BillingStorage';
import Stripe from 'stripe';

const MODULE_NAME = 'BillUnpaidTransactionTask';

export default class BillUnpaidTransactionTask extends TenantSchedulerTask {
  public async processTenant(tenant: Tenant, /* config: TaskConfig */): Promise<void> {
    try {
      let stripe: Stripe;
      // Check if OCPI component is active
      if (Utils.isTenantComponentActive(tenant, TenantComponents.BILLING)) {
        const billingImpl = await BillingFactory.getBillingImpl(tenant);
        if (billingImpl) {
          // Get the lock
          const lock = await LockingHelper.acquireBillUnpaidTransactionsLock(tenant.id);
          if (lock) {
            try {
              // Get all local finished and unpaid Transaction
              const transactionsMDB: { _id: number }[] = await global.database.getCollection<{ _id: number }>(tenant.id, 'transactions')
                .aggregate<{ _id: number }>(
                [
                  {
                    // Sessions with a open billing status
                    $match: {
                      'stop': { $exists: true },
                      'billingData.stop.invoiceStatus': 'open'
                    }
                  },
                  {
                    $project: { '_id': 1 }
                  }
                ]).toArray();

              if (!Utils.isEmptyArray(transactionsMDB)) {
                await Logging.logInfo({
                  tenantID: tenant.id,
                  action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                  module: MODULE_NAME, method: 'processTenant',
                  message: `Synchronize and bill ${transactionsMDB.length} unpaid transactions is pending`,
                });
                for (const transactionMDB of transactionsMDB) {
                  const transactionLock = await LockingHelper.acquireBillUnpaidTransactionLock(tenant.id, transactionMDB._id);
                  if (transactionLock) {
                    try {
                      // Get Transaction
                      const transaction = await TransactionStorage.getTransaction(tenant, transactionMDB._id, { withUser: true, withChargingStation: true });
                      if (!transaction) {
                        await Logging.logError({
                          tenantID: tenant.id,
                          action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                          module: MODULE_NAME, method: 'processTenant',
                          message: `Transaction '${transactionMDB._id}' not found`,
                        });
                        continue;
                      }
                      // Get Charging Station
                      const chargingStation = transaction.chargeBox;
                      if (!chargingStation) {
                        await Logging.logError({
                          tenantID: tenant.id,
                          action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                          module: MODULE_NAME, method: 'processTenant',
                          message: `Charging Station '${transaction.chargeBoxID}' not found`,
                        });
                        continue;
                      }
                      // Check for the last transaction
                      const lastTransaction = await TransactionStorage.getLastTransactionFromChargingStation(tenant, transaction.chargeBoxID, transaction.connectorId);
                      if (transaction.id === lastTransaction?.id) {
                        // Avoid conflict with a session which is still in progress
                        const connector = Utils.getConnectorFromID(chargingStation, transaction.connectorId);
                        if (connector.status !== ChargePointStatus.AVAILABLE) {
                          // Do nothing - connector is being used
                          continue;
                        }
                      }

                      // Get invoice by id
                      if (!transaction.billingData?.stop?.invoiceID) {
                        await Logging.logError({
                          tenantID: tenant.id,
                          action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                          module: MODULE_NAME, method: 'processTenant',
                          message: `Transaction '${transaction.id}' is not billed`,
                        });
                        continue;
                      }

                      const invoice = await BillingStorage.getInvoice(tenant, transaction.billingData.stop.invoiceID);
                      // Synchronize open bills
                      const billingDataStop: BillingDataTransactionStop = await billingImpl.synchronizeUnpaidBills(transaction, invoice);
                      // Update
                      transaction.billingData.stop = billingDataStop;
                      transaction.billingData.lastUpdate = new Date();

                      // Save
                      await TransactionStorage.saveTransactionBillingData(tenant, transaction.id, transaction.billingData);
                      await Logging.logInfo({
                        tenantID: tenant.id,
                        action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                        actionOnUser: transaction.user,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Synchronize unpaid bill for transaction '${transaction.id}' has completed successfully`,
                      });
                    } catch (error) {
                      await Logging.logError({
                        tenantID: tenant.id,
                        action: ServerAction.SYNCHRONIZE_UNPAID_BILLS,
                        module: MODULE_NAME, method: 'processTenant',
                        message: `Failed to synchronize unpaid transaction '${transactionMDB._id}'`,
                        detailedMessages: { error: error.stack, transaction: transactionMDB }
                      });
                    } finally {
                      // Release the lock
                      await LockingManager.release(transactionLock);
                    }
                  }
                }
              }
            } finally {
              // Release the lock
              await LockingManager.release(lock);
            }
          }
        }
      }
    } catch (error) {
      await Logging.logActionExceptionMessage(tenant.id, ServerAction.SYNCHRONIZE_UNPAID_BILLS, error);
    }
  }
}

