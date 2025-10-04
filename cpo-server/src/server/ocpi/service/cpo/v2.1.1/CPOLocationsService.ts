import { NextFunction, Request, Response } from 'express';
import { OCPILocation, OCPILocationOptions } from '../../../../../types/ocpi/OCPILocation';

import AppError from '../../../../../exception/AppError';
import Constants from '../../../../../utils/Constants';
import DatabaseUtils from '../../../../../storage/mongodb/DatabaseUtils';
import Logging from '../../../../../utils/Logging';
import OCPIClientFactory from '../../../../../client/ocpi/OCPIClientFactory';
import { OCPIConnector } from '../../../../../types/ocpi/OCPIConnector';
import { OCPIStatusCode } from '../../../../../types/ocpi/OCPIStatusCode';
import OCPIUtils from '../../../OCPIUtils';
import OCPIUtilsService from '../../OCPIUtilsService';
import { OcpiSetting } from '../../../../../types/Setting';
import { ServerAction } from '../../../../../types/Server';
import SiteStorage from '../../../../../storage/mongodb/SiteStorage';
import { StatusCodes } from 'http-status-codes';
import Tenant from '../../../../../types/Tenant';
import TenantStorage from '../../../../../storage/mongodb/TenantStorage';
import Utils from '../../../../../utils/Utils';

const MODULE_NAME = 'CPOLocationsService';

export default class CPOLocationsService {
  public static async handleGetLocations(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Split URL Segments
    //   /ocpi/cpo/2.0/locations/{location_id}
    //   /ocpi/cpo/2.0/locations/{location_id}/{evse_uid}
    //   /ocpi/cpo/2.0/locations/{location_id}/{evse_uid}/{connector_id}
    const { tenant, ocpiEndpoint } = req;
    await Logging.logInfo({
      tenantID: tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleGetLocations',
      message: `ocpi -> cpo get locations have been recived , endpoint: '${ocpiEndpoint.id}'`,
      detailedMessages:   `URL:'${req.path}  ' Offset :'${req.query?.offset?.toString()}' ' limit:'${req.query?.limit?.toString()}' `
    });
    // Remove action
    const urlSegment = req.path.substring(1).split('/');
    urlSegment.shift();
    // Get filters
    const locationId = urlSegment.shift();
    const evseUid = urlSegment.shift();
    const evseConnectorId = urlSegment.shift();
    let ocpiResult = {};
    const ocpiClient = await OCPIClientFactory.getOcpiClient(tenant, ocpiEndpoint);
    // Define get option
    const options: OCPILocationOptions = {
      addChargeBoxAndOrgIDs: false,
      countryID: ocpiClient.getLocalCountryCode(action),
      partyID: ocpiClient.getLocalPartyID(action)
    };

    // get tenant's children
    let tenants = [tenant];
    if (tenant.type === 'Parent') {
      const children = await TenantStorage.getTenants({ tenantParentID: tenant.id }, Constants.DB_PARAMS_MAX_LIMIT);
      tenants = [...tenants, ...children.result];
    }
    if (locationId && !DatabaseUtils.isObjectID(locationId)) {
      throw new AppError({
        module: MODULE_NAME, method: 'handleGetLocations', action,
        errorCode: StatusCodes.UNPROCESSABLE_ENTITY,
        message: `Location ID '${locationId}' has a wrong format`,
        ocpiError: OCPIStatusCode.CODE_3000_GENERIC_SERVER_ERROR,
        detailedMessages: { locationId, evseUid, evseConnectorId }
      });
    }
    // Process request
    if (locationId && evseUid && evseConnectorId) {
      ocpiResult = await CPOLocationsService.getConnector(tenants, locationId, evseUid, evseConnectorId, options, ocpiClient.getSettings());
      // Check if at least of site found
      if (!ocpiResult) {
        throw new AppError({
          module: MODULE_NAME, method: 'handleGetLocations', action,
          errorCode: StatusCodes.NOT_FOUND,
          message: `EVSE Connector ID '${evseConnectorId}' not found on Charging Station ID '${evseUid}' and Location ID '${locationId}'`,
          ocpiError: OCPIStatusCode.CODE_3000_GENERIC_SERVER_ERROR,
          detailedMessages: { locationId, evseUid, evseConnectorId }
        });
      }
    } else if (locationId && evseUid) {
      ocpiResult = await OCPIUtilsService.getCpoEvse(tenants, locationId, evseUid, options, ocpiClient.getSettings());
      // Check if at least of site found
      if (!ocpiResult) {
        throw new AppError({
          module: MODULE_NAME, method: 'handleGetLocations', action,
          errorCode: StatusCodes.NOT_FOUND,
          message: `EVSE UID not found '${evseUid}' in Location ID '${locationId}'`,
          ocpiError: OCPIStatusCode.CODE_3000_GENERIC_SERVER_ERROR,
          detailedMessages: { locationId, evseUid }
        });
      }
    } else if (locationId) {
      // Get single location
      ocpiResult = await CPOLocationsService.getLocation(tenants, locationId, options, ocpiClient.getSettings());
      // Check if at least of site found
      if (!ocpiResult) {
        throw new AppError({
          module: MODULE_NAME, method: 'handleGetLocations', action,
          errorCode: StatusCodes.NOT_FOUND,
          message: `Location ID '${locationId}' not found`,
          ocpiError: OCPIStatusCode.CODE_3000_GENERIC_SERVER_ERROR,
          detailedMessages: { locationId }
        });
      }
    } else {
      // Get query parameters
      const offset = (req.query.offset) ? Utils.convertToInt(req.query.offset) : 0;
      const limit = (req.query.limit && Utils.convertToInt(req.query.limit) < Constants.OCPI_RECORDS_LIMIT) ? Utils.convertToInt(req.query.limit) : Constants.OCPI_RECORDS_LIMIT;
      // Get all locations
      const locations = await OCPIUtilsService.getAllCpoLocations(tenants, limit, offset, options, true, ocpiClient.getSettings());
      ocpiResult = locations.result;
      // Set header
      res.set({
        'X-Total-Count': locations.count,
        'X-Limit': Constants.OCPI_RECORDS_LIMIT
      });
      // Return next link
      const nextUrl = OCPIUtils.buildNextUrl(req, OCPIUtilsService.getBaseUrl(req), offset, limit, locations.count);
      if (nextUrl) {
        res.links({
          next: nextUrl
        });
      }
    }
    await Logging.logDebug({
      tenantID: tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleGetLocations',
      message: '<< Get cpo Locations Have been processed :',
      detailedMessages: ocpiResult
    });
    res.json(OCPIUtils.success(ocpiResult));
    next();
  }

  private static async getLocation(tenants: Tenant[], locationId: string, options: OCPILocationOptions, settings: OcpiSetting): Promise<OCPILocation> {
    // Get site
    for (const tenant of tenants) {
      const site = await SiteStorage.getSite(tenant, locationId);
      if (site) {
        return OCPIUtilsService.convertSite2Location(tenant, site, options, true, settings);
      }
    }
  }

  private static async getConnector(tenants: Tenant[], locationId: string, evseUid: string, connectorId: string, options: OCPILocationOptions, settings: OcpiSetting): Promise<OCPIConnector> {
    // Get site
    const evse = await OCPIUtilsService.getCpoEvse(tenants, locationId, evseUid, options, settings);
    // Find the Connector
    return evse?.connectors.find((connector) => connector.id === connectorId);
  }
}
