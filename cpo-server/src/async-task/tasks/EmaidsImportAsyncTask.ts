import { ActionsResponse, ImportStatus } from '../../types/GlobalType';

import AbstractAsyncTask from '../AsyncTask';
import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DbParams from '../../types/database/DbParams';
import ImportHelper from './ImportHelper';
import LockingHelper from '../../locking/LockingHelper';
import LockingManager from '../../locking/LockingManager';
import Logging from '../../utils/Logging';
import { ServerAction } from '../../types/Server';
import Site from '../../types/Site';
import SiteStorage from '../../storage/mongodb/SiteStorage';
import TenantStorage from '../../storage/mongodb/TenantStorage';
import Utils from '../../utils/Utils';
import EmaidStorage from '../../storage/mongodb/EmaidStorage';
import { ImportedEmaid } from '../../types/Emaid';

const MODULE_NAME = 'EmaidsImportAsyncTask';

export default class EmaidsImportAsyncTask extends AbstractAsyncTask {
  protected async executeAsyncTask(): Promise<void> {
    const importEmaidsLock = await LockingHelper.acquireImportEmaidsLock(this.getAsyncTask().tenantID);
    const importHelper = new ImportHelper();
    const existingSites: Map<string, Site> = new Map();
    if (importEmaidsLock) {
      const tenant = await TenantStorage.getTenant(this.getAsyncTask().tenantID);
      try {
        // If we never got the sites from db -> construct array of existing sites
        if (existingSites.size === 0) {
          const sites = await SiteStorage.getSites(tenant, { issuer: true }, Constants.DB_PARAMS_MAX_LIMIT, ['id', 'name']);
          for (const site of sites.result) {
            existingSites.set(site.id, site);
          }
        }
        const dbParams: DbParams = { limit: Constants.IMPORT_PAGE_SIZE, skip: 0 };
        let importedEmaids: DataResult<ImportedEmaid>;
        const result: ActionsResponse = {
          inError: 0,
          inSuccess: 0,
        };
        const startTime = new Date().getTime();
        // Get total number of Emaids to import
        const totalEmaidsToImport = await EmaidStorage.getImportedEmaidsCount(tenant);
        if (totalEmaidsToImport > 0) {
          await Logging.logInfo({
            tenantID: tenant.id,
            action: ServerAction.EMAIDS_IMPORT,
            module: MODULE_NAME, method: 'processTenant',
            message: `${totalEmaidsToImport} Emaid(s) are going to be imported...`
          });
        }
        do {
          // Get the imported Emaids
          importedEmaids = await EmaidStorage.getImportedEmaids(tenant, { status: ImportStatus.READY }, dbParams);
          for (const importedEmaid of importedEmaids.result) {
            try {
              // Check & Import the Emaid (+ User if present)
              await importHelper.processImportedEmaid(tenant, importedEmaid, existingSites);
              // Remove the imported Emaid
              await EmaidStorage.deleteImportedEmaid(tenant, importedEmaid.id);
              result.inSuccess++;
            } catch (error) {
              // Mark the imported Emaid faulty with the reason
              importedEmaid.status = ImportStatus.ERROR;
              importedEmaid.errorDescription = error.message;
              result.inError++;
              await EmaidStorage.saveImportedEmaid(tenant, importedEmaid);
              await Logging.logError({
                tenantID: tenant.id,
                action: ServerAction.EMAIDS_IMPORT,
                module: MODULE_NAME, method: 'processTenant',
                message: `Cannot import Emaid ID '${importedEmaid.id}': ${error.message}`,
                detailedMessages: { importedEmaid, error: error.stack }
              });
            }
          }
          if (!Utils.isEmptyArray(importedEmaids.result) && (result.inError + result.inSuccess) > 0) {
            const intermediateDurationSecs = Math.round((new Date().getTime() - startTime) / 1000);
            await Logging.logDebug({
              tenantID: tenant.id,
              action: ServerAction.EMAIDS_IMPORT,
              module: MODULE_NAME, method: 'processTenant',
              message: `${result.inError + result.inSuccess}/${totalEmaidsToImport} Emaid(s) have been processed in ${intermediateDurationSecs}s...`
            });
          }
        } while (!Utils.isEmptyArray(importedEmaids?.result));
        // Log final results
        const executionDurationSecs = Math.round((new Date().getTime() - startTime) / 1000);
        await Logging.logActionsResponse(tenant.id, ServerAction.EMAIDS_IMPORT, MODULE_NAME, 'processTenant', result,
          `{{inSuccess}}Emaid(s) have been imported successfully in ${executionDurationSecs}s in Tenant ${Utils.buildTenantName(tenant)}`,
          `{{inError}} Emaid(s) failed to be imported in ${executionDurationSecs}s in Tenant ${Utils.buildTenantName(tenant)}`,
          `{{inSuccess}} Emaid(s) have been imported successfully but {{inError}} failed in ${executionDurationSecs}s in Tenant ${Utils.buildTenantName(tenant)}`,
          `Not Emaid has been imported in ${executionDurationSecs}s in Tenant ${Utils.buildTenantName(tenant)}`
        );
      } catch (error) {
        // Log error
        await Logging.logActionExceptionMessage(tenant.id, ServerAction.EMAIDS_IMPORT, error);
      } finally {
        // Release the lock
        await LockingManager.release(importEmaidsLock);
      }
    }
  }
}
