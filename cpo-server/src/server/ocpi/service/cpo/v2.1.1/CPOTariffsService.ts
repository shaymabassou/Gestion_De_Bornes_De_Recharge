import { NextFunction, Request, Response } from 'express';
import { OCPIPriceOptions, OCPITariff, OCPITariffDimensionType } from '../../../../../types/ocpi/OCPITariff';
import { PricingSettings, PricingSettingsType } from '../../../../../types/Setting';

import AppError from '../../../../../exception/AppError';
import Constants from '../../../../../utils/Constants';
import { DataResult } from '../../../../../types/DataResult';
import { HTTPError } from '../../../../../types/HTTPError';
import Logging from '../../../../../utils/Logging';
import OCPIClientFactory from '../../../../../client/ocpi/OCPIClientFactory';
import { OCPIStatusCode } from '../../../../../types/ocpi/OCPIStatusCode';
import OCPIUtils from '../../../OCPIUtils';
import OCPIUtilsService from '../../OCPIUtilsService';
import { ServerAction } from '../../../../../types/Server';
import SettingStorage from '../../../../../storage/mongodb/SettingStorage';
import Tenant from '../../../../../types/Tenant';
import TenantStorage from '../../../../../storage/mongodb/TenantStorage';
import Utils from '../../../../../utils/Utils';

const MODULE_NAME = 'CPOTariffsService';

export default class CPOTariffsService {
  public static async handleGetTariffs(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const { tenant, ocpiEndpoint } = req;
    await Logging.logInfo({
      tenantID: tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleGetTariffs',
      message: `ocpi -> cpo get tariffs have been recived , endpoint: '${ocpiEndpoint.id}'`,
      detailedMessages:   `URL:'${req.path}  ' Offset :'${req.query?.offset?.toString()}' ' limit:'${req.query?.limit?.toString()}' `
    });
    // Get query parameters
    const offset = (req.query.offset) ? Utils.convertToInt(req.query.offset) : 0;
    const limit = (req.query.limit) ? Utils.convertToInt(req.query.limit) : 1000;

    // get tenant's children
    let tenants = [tenant];
    if (tenant.type === 'Parent') {
      const children = await TenantStorage.getTenants({ tenantParentID: tenant.id }, Constants.DB_PARAMS_MAX_LIMIT);
      tenants = [...tenants, ...children.result];
    }
    const ocpiClient = await OCPIClientFactory.getOcpiClient(tenant, ocpiEndpoint);
    const options: OCPIPriceOptions = {
      countryID: ocpiClient.getLocalCountryCode(action),
      partyID: ocpiClient.getLocalPartyID(action)
    };

    // Get all tariffs
    const tariffs = await OCPIUtilsService.getAllCpoTariffs(tenants, limit, offset,options, ocpiClient.getSettings(), Utils.convertToDate(req.query.date_from), Utils.convertToDate(req.query.date_to));
    if (tariffs.count === 0) {
      await Logging.logDebug({
        tenantID: tenant.id,
        action: action,
        module: MODULE_NAME, method: 'handleGetTariffs',
        message: '>> No OCPI Tariffs found',
        detailedMessages: tariffs.result
      });
      res.json(OCPIUtils.success([]));
      next();
    }
    // Set header
    res.set({
      'X-Total-Count': tariffs.count,
      'X-Limit': Constants.OCPI_RECORDS_LIMIT
    });
    // Return next link
    const nextUrl = OCPIUtils.buildNextUrl(req, OCPIUtilsService.getBaseUrl(req), offset, limit, tariffs.count);
    if (nextUrl) {
      res.links({
        next: nextUrl
      });
    }
    await Logging.logDebug({
      tenantID: tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleGetTariffs',
      message: '>> Get cpo tariffs Have been processed :',
      detailedMessages: tariffs.result
    });
    res.json(OCPIUtils.success(tariffs.result));
    next();
  }

  private static async getAllTariffs(tenant: Tenant, limit: number, skip: number, dateFrom?: Date, dateTo?: Date): Promise<DataResult<OCPITariff>> {
    // Result
    const tariffs: OCPITariff[] = [];
    let tariff: OCPITariff;
    if (tenant.components?.pricing?.active) {
      // Get simple pricing settings
      const pricingSettings = await SettingStorage.getPricingSettings(tenant, limit, skip, dateFrom, dateTo);
      if (pricingSettings.type === PricingSettingsType.SIMPLE && pricingSettings.simple) {
        tariff = OCPIUtils.convertSimplePricingSettingToOcpiTariff(pricingSettings.simple);
        if (tariff.currency && tariff.elements[0].price_components[0].price > 0) {
          tariffs.push(tariff);
        } else if (tariff.currency && tariff.elements[0].price_components[0].price === 0) {
          tariff = this.convertPricingSettings2ZeroFlatTariff(pricingSettings);
          tariffs.push(tariff);
        }
      }
    }
    return {
      count: tariffs.length,
      result: tariffs
    };
  }


  private static convertPricingSettings2ZeroFlatTariff(pricingSettings: PricingSettings): OCPITariff {
    const tariff = {} as OCPITariff;
    tariff.id = '1';
    tariff.elements = [
      {
        price_components: [
          {
            type: OCPITariffDimensionType.FLAT,
            price: 0,
            step_size: 0,
          }
        ]
      }
    ];
    switch (pricingSettings.type) {
      case PricingSettingsType.SIMPLE:
        tariff.currency = pricingSettings.simple.currency;
        tariff.last_updated = pricingSettings.simple.last_updated;
        break;
      default:
        tariff.currency = 'EUR';
        tariff.last_updated = new Date();
        break;
    }
    return tariff;
  }
}
