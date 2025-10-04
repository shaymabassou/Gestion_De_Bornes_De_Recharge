/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Action, Entity } from '../../../../types/Authorization';
import ChargingStation, { Connector } from '../../../../types/ChargingStation';
import { DataResult, PricingDefinitionDataResult } from '../../../../types/DataResult';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import { NextFunction, Request, Response } from 'express';
import { OCPIPriceOptions, OCPITariff } from '../../../../types/ocpi/OCPITariff';
import PricingDefinition, { PricingContext, PricingEntity, ResolvedPricingDefinition, ResolvedPricingModel } from '../../../../types/Pricing';
import Tenant, { TenantComponents } from '../../../../types/Tenant';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import AuthorizationService from './AuthorizationService';
import Constants from '../../../../utils/Constants';
import CpoOCPIClient from '../../../../client/ocpi/CpoOCPIClient';
import DatabaseUtils from '../../../../storage/mongodb/DatabaseUtils';
import Logging from '../../../../utils/Logging';
import LoggingHelper from '../../../../utils/LoggingHelper';
import OCPIClientFactory from '../../../../client/ocpi/OCPIClientFactory';
import OCPIEndpointStorage from '../../../../storage/mongodb/OCPIEndpointStorage';
import { OCPIRole } from '../../../../types/ocpi/OCPIRole';
import OCPIUtilsService from '../../../ocpi/service/OCPIUtilsService';
import PricingFactory from '../../../../integration/pricing/PricingFactory';
import PricingHelper from '../../../../integration/pricing/PricingHelper';
import PricingStorage from '../../../../storage/mongodb/PricingStorage';
import PricingValidatorRest from '../validator/PricingValidatorRest';
import { ServerAction } from '../../../../types/Server';
import SettingStorage from '../../../../storage/mongodb/SettingStorage';
import Site from '../../../../types/Site';
import SiteArea from '../../../../types/SiteArea';
import TenantStorage from '../../../../storage/mongodb/TenantStorage';
import UserToken from '../../../../types/UserToken';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
import { forEach } from 'lodash';

const MODULE_NAME = 'PricingService';

export default class PricingService {

  public static async handleResolvePricingModel(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.RESOLVE, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleResolvePricingModel');
    // Filter
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingModelResolve(req.query);
    let pricingContext: PricingContext = null;
    let pricingDefinitions: ResolvedPricingDefinition[] = [];
    const pricingImpl = await PricingFactory.getPricingImpl(req.tenant);
    if (pricingImpl) {
      // Fetch the charging station data required for resolving the pricing context
      // TODO: how to only read the required data? - required projected fields: ['id', 'companyID', 'siteID', 'siteAreaID', 'coordinates']
      const chargingStation = await UtilsService.checkAndGetChargingStationAuthorization(req.tenant, req.user, filteredRequest.ChargingStationID, Action.READ, action);
      // Resolve the pricing context
      pricingContext = PricingHelper.buildUserPricingContext(req.tenant, filteredRequest.UserID, chargingStation, filteredRequest.ConnectorID, filteredRequest.StartDateTime);
      const pricingModel: ResolvedPricingModel = await pricingImpl.resolvePricingContext(pricingContext);
      pricingDefinitions = pricingModel?.pricingDefinitions;
    }
    res.json({
      pricingContext,
      pricingDefinitions
    });
    next();
  }

  public static async handleGetPricingDefinition(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.READ, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleGetPricingDefinition');
    // Filter
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingDefinitionGet(req.query);
    // Check and get pricing
    const pricingDefinition = await UtilsService.checkAndGetPricingDefinitionAuthorization(
      req.tenant, req.user, filteredRequest.ID, Action.READ, action, null, { withEntityInformation: filteredRequest.WithEntityInformation }, true);
    res.json(pricingDefinition);
    next();
  }

  public static async handleGetPricingDefinitions(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.LIST, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleGetPricingDefinitions');
    // Filter
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingDefinitionsGet(req.query);
    // Check dynamic auth
    const authorizations = await AuthorizationService.checkAndGetPricingDefinitionsAuthorizations(
      req.tenant, req.user, filteredRequest, false);
    if (!authorizations.authorized) {
      UtilsService.sendEmptyDataResult(res, next);
      return;
    }
    // Get the pricing definitions
    const pricingDefinitions = await PricingStorage.getPricingDefinitions(req.tenant,
      {
        entityID: filteredRequest.EntityID || null,
        entityType: filteredRequest.EntityType || null,
        withEntityInformation: filteredRequest?.WithEntityInformation,
        ...authorizations.filters
      }, {
        limit: filteredRequest.Limit,
        skip: filteredRequest.Skip,
        sort: UtilsService.httpSortFieldsToMongoDB(filteredRequest.SortFields),
        onlyRecordCount: filteredRequest.OnlyRecordCount
      },
      authorizations.projectFields
    ) as PricingDefinitionDataResult;
    // Assign projected fields
    if (authorizations.projectFields) {
      pricingDefinitions.projectFields = authorizations.projectFields;
    }
    // Add Auth flags
    if (filteredRequest.WithAuth) {
      await AuthorizationService.addPricingDefinitionsAuthorizations(req.tenant, req.user, pricingDefinitions, authorizations);
    }
    // Alter the canCreate flag according to the pricing definition context
    pricingDefinitions.canCreate = await PricingService.alterCanCreate(req, action, filteredRequest.EntityType, filteredRequest.EntityID, pricingDefinitions.canCreate);
    res.json(pricingDefinitions);
    next();
  }

  public static async handleGetPricingDefinitionsQrCode(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const tenantName = Utils.getTenantFromUrl(req);
    const tenant = await TenantStorage.getTenantBySubdomain(tenantName);
    // Check if component is active
    Utils.isTenantComponentActive(tenant, TenantComponents.PRICING);
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingDefinitionsGetQrCode(req.query);
    // Get the pricing definitions
    const pricingDefinitions = await PricingStorage.getPricingDefinitions(tenant,
      {
        entityID: filteredRequest.EntityID || null,
        entityType: filteredRequest.EntityType || null,
        withEntityInformation: filteredRequest?.WithEntityInformation,
      }, {
        limit: filteredRequest.Limit,
        skip: filteredRequest.Skip,
        sort: UtilsService.httpSortFieldsToMongoDB(filteredRequest.SortFields),
        onlyRecordCount: filteredRequest.OnlyRecordCount
      },
    ) as PricingDefinitionDataResult;
    pricingDefinitions.canCreate = await PricingService.alterCanCreate(req, action, filteredRequest.EntityType, filteredRequest.EntityID, pricingDefinitions.canCreate);
    res.json(pricingDefinitions);
    next();
  }

  public static async handleEditRemotePricing(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = PricingValidatorRest.getInstance().validateEditRemotePricing(req.query);
    // Set limit && offset
    const offset = (filteredRequest.Skip) ? Utils.convertToInt(filteredRequest.Skip) : 0;
    const limit = (filteredRequest.Limit) ? Utils.convertToInt(filteredRequest.Limit) : 1000;
    let tenant = {} as Tenant;
    // Get tenant by query subdomain
    if (filteredRequest.subdomain) {
      tenant = await TenantStorage.getTenantBySubdomain(filteredRequest.subdomain);
    } else {
      throw new AppError({
        errorCode: HTTPError.MISSING_SUBDOMAIN_PARAMETER,
        message: 'Missing subdomain parameter',
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        user: req.user,
        action: action
      });
    }

    if (!tenant) {
      throw new AppError({
        errorCode: HTTPError.TENANT_NOT_FOUND,
        message: `Tenant subdomain '${filteredRequest.subdomain}' not found'`,
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        user: req.user,
        action: action
      });
    }

    const theme = {
      logo: (await TenantStorage.getTenantLogo(tenant)).logo,
      favIcon: (await TenantStorage.getTenantFavicon(tenant)).favicon,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      name: tenant.name,
      address: tenant.address
    };

    // if tenant is child get parent tenant
    const parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);
    const children = await TenantStorage.getTenants({ tenantParentID: parentTenant.id }, Constants.DB_PARAMS_MAX_LIMIT);
    const tenants = [parentTenant, ...children.result] as Tenant[];
    // Get ocpi Settings
    const ocpiSettings = await SettingStorage.getOCPISettings(parentTenant);

    if (!parentTenant?.components?.ocpi?.active || !ocpiSettings?.ocpi?.cpo) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        action,
        user: req.user,
        message: 'Roaming service is not active/configured'
      });
      throw new AppError({
        errorCode: HTTPError.MISSING_SETTINGS,
        message: 'Roaming service is not active/configured',
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        user: req.user,
        action: action
      });
    }

    const options: OCPIPriceOptions = {
      countryID: ocpiSettings.ocpi.cpo.countryCode,
      partyID: ocpiSettings.ocpi.cpo.partyID
    };

    const TarifRoaming = [] as OCPITariff[];

    try {
      const response = {} as DataResult<OCPITariff>;
      for (const Mytenant of tenants) {
        const pricingDefinitions = await PricingStorage.getPricingDefinitions(Mytenant, { roaming: true }, { limit:1000, skip:0 },
          ['id', 'dimensions', 'restrictions', 'staticRestrictions', 'name', 'ocpiData', 'description']) as PricingDefinitionDataResult;
        // Add pricing ocpi data to results
        for (const price of pricingDefinitions.result) {
          // convert price to tariff
          const tariffOcpi = await OCPIUtilsService.convertPrice2Tariff(Mytenant, price, options, ocpiSettings.ocpi);
          // update existing price ocpi data
          if (price.ocpiData?.tariff) {
            tariffOcpi.id = options.countryID + '*' + options.partyID + '_' + price.ocpiData.tariff.id;
            price.ocpiData = {
              ...price.ocpiData,
              tariffUpdatedOn: new Date()
            };
          }

          // Add tarif to price ocpiData
          price.ocpiData = {
            ...price.ocpiData,
            tariff: tariffOcpi
          };
          TarifRoaming.push(price.ocpiData.tariff);
        }
      }

      response.count = TarifRoaming.length;
      response.result = TarifRoaming;
      // limit and offset
      res.json({ ...response, ...theme });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        action,
        user: req.user,
        message: `Tenant ${tenant.id}: cannot edit pricings ${error.message}`
      });
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'An unexpected server error occurred. Check the server\'s logs!',
        module: MODULE_NAME, method: 'handleEditRemotePricing',
        user: req.user,
        action: action
      });
    }

  }

  public static async handleCreatePricingDefinition(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.CREATE, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleCreatePricingDefinition');
    // Filter
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingDefinitionCreate(req.body);
    // Check Pricing Definition
    UtilsService.checkIfPricingDefinitionValid(filteredRequest, req);
    // Get dynamic auth
    await AuthorizationService.checkAndGetPricingDefinitionAuthorizations(
      req.tenant, req.user, {}, Action.CREATE, filteredRequest);
    // Check authorization and get the site ID depending on the entity type
    const siteID = await PricingService.checkAuthorizationAndGetSiteID(req, action, filteredRequest.entityType, filteredRequest.entityID);
    // Check that the pricing definitions can be changed for that site
    if (siteID) {
      await UtilsService.checkAndGetSiteAuthorization(req.tenant, req.user, siteID, Action.MAINTAIN_PRICING_DEFINITIONS, action);
    }

    // Create pricing
    let newPricingDefinition: PricingDefinition = {
      ...filteredRequest,
      siteID,
      issuer: true,
      createdBy: { id: req.user.id },
      createdOn: new Date(),
      // Update timestamp
      lastChangedBy: { id: req.user.id },
      lastChangedOn: new Date()
    } as PricingDefinition;

    // If pricing is roaming create ocpiData
    if (filteredRequest.roaming) {
      // if tenant is child get parent tenant
      const parentTenant = (req.tenant.type !== 'Child') ? req.tenant : await TenantStorage.getTenant(req.tenant.parentID);

      // Get ocpi Settings
      const ocpiSettings = await SettingStorage.getOCPISettings(parentTenant);

      if (!parentTenant?.components?.ocpi?.active || !ocpiSettings?.ocpi?.cpo) {
        await Logging.logError({
          tenantID: req.tenant.id,
          module: MODULE_NAME, method: 'handleEditRemotePricing',
          action,
          user: req.user,
          message: 'Roaming service is not active/configured cannot create roaming data for tariff'
        });
      } else {
        const options: OCPIPriceOptions = {
          countryID: ocpiSettings.ocpi.cpo.countryCode,
          partyID: ocpiSettings.ocpi.cpo.partyID
        };

        newPricingDefinition = {
          ...newPricingDefinition,
          ocpiData: {
            tariff: await OCPIUtilsService.convertPrice2Tariff(req.tenant, newPricingDefinition, options, ocpiSettings?.ocpi),
            tariffUpdatedOn: new Date()
          }
        };
      }
    }

    // Save
    newPricingDefinition.id = await PricingStorage.savePricingDefinition(req.tenant, newPricingDefinition);
    // Log
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user, module: MODULE_NAME, method: 'handleCreatePricingDefinition',
      message: `Pricing model '${newPricingDefinition.id}' has been created successfully`,
      action: action,
      detailedMessages: { pricingDefinition: newPricingDefinition }
    });
    res.json(Object.assign({ id: newPricingDefinition.id }, Constants.REST_RESPONSE_SUCCESS));
    next();
  }

  public static async handleUpdatePricingDefinition(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.UPDATE, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleUpdatePricingDefinition');
    // Filter
    const filteredRequest = PricingValidatorRest.getInstance().validatePricingDefinitionUpdate(req.body);
    // Check Pricing Definition
    UtilsService.checkIfPricingDefinitionValid(filteredRequest, req);
    // Check and Get Pricing
    const pricingDefinition = await UtilsService.checkAndGetPricingDefinitionAuthorization(
      req.tenant, req.user, filteredRequest.id, Action.UPDATE, action, filteredRequest);

    // if tenant is child get parent tenant
    const parentTenant = (req.tenant.type !== 'Child') ? req.tenant : await TenantStorage.getTenant(req.tenant.parentID);

    // Update timestamp
    const lastChangedBy = { id: req.user.id };
    const lastChangedOn = new Date();
    // Check authorization and get the site ID depending on the entity type
    const siteID = await PricingService.checkAuthorizationAndGetSiteID(req, action, filteredRequest.entityType, filteredRequest.entityID);
    // Check that the pricing definitions can be changed for that site
    if (siteID) {
      await UtilsService.checkAndGetSiteAuthorization(req.tenant, req.user, siteID, Action.MAINTAIN_PRICING_DEFINITIONS, action);
    }

    // Update
    let newPricingDefinition = {
      ...pricingDefinition,
      ...filteredRequest,
      lastChangedBy,
      lastChangedOn,
      siteID
    };

    if (newPricingDefinition.roaming) {
      // Get ocpi Client
      const ocpiClient = await OCPIClientFactory.getAvailableOcpiClient(parentTenant, OCPIRole.CPO) as CpoOCPIClient;
      console.log(!parentTenant?.components?.ocpi?.active);
      if (!parentTenant?.components?.ocpi?.active || !ocpiClient.getSettings()?.cpo) {
        await Logging.logError({
          tenantID: req.tenant.id,
          module: MODULE_NAME, method: 'handleUpdatePricingDefinition',
          action,
          user: req.user,
          message: 'Roaming service is not active/configured cannot update roaming data for tariff'
        });
      } else {
        const options: OCPIPriceOptions = {
          countryID: ocpiClient.getLocalCountryCode(action),
          partyID: ocpiClient.getLocalPartyID(action)
        };
        if (pricingDefinition.name !== newPricingDefinition.name) {
          // eslint-disable-next-line no-undefined
          newPricingDefinition.ocpiData = undefined;
        }

        newPricingDefinition = {
          ...newPricingDefinition,
          ocpiData: {
            tariff: await OCPIUtilsService.convertPrice2Tariff(req.tenant, newPricingDefinition, options, ocpiClient.getSettings()),
            tariffUpdatedOn: new Date(),
            tariffCheckedOn: pricingDefinition.ocpiData?.tariffCheckedOn,
            inEmsp: newPricingDefinition.ocpiData?.inEmsp
          }
        };
        const success = await PricingService.updateInsertTariffRoaming(parentTenant, req.user, newPricingDefinition, action, ocpiClient);
        newPricingDefinition.ocpiData.inEmsp = success;
      }
    }

    // Update Pricing local database
    await PricingStorage.savePricingDefinition(req.tenant, newPricingDefinition);

    // Log
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user, module: MODULE_NAME, method: 'handleUpdatePricingDefinition',
      message: `Pricing model '${pricingDefinition.id}' has been updated successfully`,
      action: action,
      detailedMessages: { pricingDefinition }
    });
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async getUsedTariff(tenant : Tenant ,chargingStation : ChargingStation , connector : Connector, roaming = true) :Promise<PricingDefinition> {
    let tariff ;
    try {
      // const selectedConnector = chargingStation.connectors.map((connector) => connector.connectorId === connectorId);
      const availableCsPricingDefinitions = await PricingService.processPricingdefinitionsFacade(tenant,PricingEntity.CHARGING_STATION,chargingStation.id,roaming);
      if (!Utils.isEmptyArray(availableCsPricingDefinitions)) {
        tariff = availableCsPricingDefinitions[0];
        console.log('-----------------------------final tariff id is entity is charging station:',tariff);
      } else {
        const SitePricingDefinitions = await PricingService.processPricingdefinitionsFacade(tenant,PricingEntity.SITE,chargingStation.siteID,roaming);
        if (!Utils.isEmptyArray(SitePricingDefinitions)) {
          tariff = SitePricingDefinitions[0];
          console.log('-----------------------------final tariff id is entity is site :',tariff);
        } else {
          const tenantPricingDefinitions = await PricingService.processPricingdefinitionsFacade(tenant,PricingEntity.TENANT,tenant.id,roaming);
          if (!Utils.isEmptyArray(tenantPricingDefinitions)) {
            tariff = tenantPricingDefinitions[0];
            console.log('-----------------------------final tariff id is entity is tenant :',tariff);
          } else {
            tariff = 'No Tariff Found';
            console.log('-------------------------------no tariff found');
          }

        }
      }
    } catch (error) {
      console.log('---------------------error :',error);
    }
    return tariff;
  }


  public static async handleDeletePricingDefinition(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.PRICING,
      Action.DELETE, Entity.PRICING_DEFINITION, MODULE_NAME, 'handleDeletePricingDefinition');
    // Filter
    const pricingDefinitionID = PricingValidatorRest.getInstance().validatePricingDefinitionDelete(req.query).ID;
    // Check and Get Pricing
    const pricingDefinition = await UtilsService.checkAndGetPricingDefinitionAuthorization(
      req.tenant, req.user, pricingDefinitionID, Action.DELETE, action);
    // Check authorization and get the site ID depending on the entity type
    const siteID = await PricingService.checkAuthorizationAndGetSiteID(req, action, pricingDefinition.entityType, pricingDefinition.entityID);
    // Check that the pricing definitions can be changed for that site
    if (siteID) {
      await UtilsService.checkAndGetSiteAuthorization(req.tenant, req.user, siteID, Action.MAINTAIN_PRICING_DEFINITIONS, action);
    }
    // Delete
    await PricingStorage.deletePricingDefinition(req.tenant, pricingDefinition.id);

    // if tenant is child get parent tenant
    const parentTenant = (req.tenant.type !== 'Child') ? req.tenant : await TenantStorage.getTenant(req.tenant.parentID);

    if (!pricingDefinition.roaming || !pricingDefinition.ocpiData?.tariff) {
      await Logging.logError({
        tenantID: req.tenant.id,
        module: MODULE_NAME, method: 'deleteTariffRoaming',
        action,
        user: req.user,
        message: `Unable to delete tariff with pricing id:${pricingDefinition.id}, pricing doesn'\t exist in IOP`
      });
    } else {
      // delete tariff in IO
      void PricingService.deleteTariffRoaming(parentTenant, req.user, pricingDefinition, action);
    }

    // Log
    await Logging.logInfo({
      tenantID: req.tenant.id,
      user: req.user, module: MODULE_NAME, method: 'handleDeletePricingDefinition',
      message: `Pricing model '${pricingDefinitionID}' has been deleted successfully`,
      action: action,
      detailedMessages: { pricingDefinition }
    });
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  private static async checkAuthorizationAndGetSiteID(req: Request, action: ServerAction, entityType: PricingEntity, entityID: string): Promise<string> {
    let siteID: string;
    let site: Site, siteArea: SiteArea, chargingStation: ChargingStation;
    switch (entityType) {
      case PricingEntity.COMPANY:
        await UtilsService.checkAndGetCompanyAuthorization(req.tenant, req.user, entityID, Action.READ, action);
        siteID = null;
        break;
      case PricingEntity.SITE:
        site = await UtilsService.checkAndGetSiteAuthorization(req.tenant, req.user, entityID, Action.READ, action);
        siteID = site.id;
        break;
      case PricingEntity.SITE_AREA:
        siteArea = await UtilsService.checkAndGetSiteAreaAuthorization(req.tenant, req.user, entityID, Action.READ, action);
        siteID = siteArea.siteID;
        break;
      case PricingEntity.CHARGING_STATION:
        chargingStation = await UtilsService.checkAndGetChargingStationAuthorization(req.tenant, req.user, entityID, Action.READ, action);
        siteID = chargingStation.siteID;
        break;
      default:
        siteID = null;
    }
    return siteID;
  }

  private static async alterCanCreate(req: Request, action: ServerAction, entityType: PricingEntity, entityID: string, canCreate: boolean): Promise<boolean> {
    if (canCreate) {
      try {
        // Get the site ID for the current entity
        const siteID = await PricingService.checkAuthorizationAndGetSiteID(req, action, entityType, entityID);
        if (siteID) {
          await UtilsService.checkAndGetSiteAuthorization(req.tenant, req.user, siteID, Action.MAINTAIN_PRICING_DEFINITIONS, action);
        }
      } catch (error) {
        canCreate = false;
        if (!(error instanceof AppAuthError)) {
          await Logging.logError({
            tenantID: req.tenant.id,
            user: req.user, module: MODULE_NAME, method: 'alterCanCreate',
            message: 'Unexpected error while checking site access permissions',
            action: action,
            detailedMessages: { error: error.stack }
          });
        }
      }
    }
    return canCreate;
  }

  private static async updateInsertTariffRoaming(tenant: Tenant, loggedUser: UserToken,
      pricing: PricingDefinition, action: ServerAction, ocpiClient: CpoOCPIClient): Promise<boolean> {
    const inEmsp: boolean = Utils.convertToBoolean(pricing.ocpiData?.inEmsp);
    try {
      // If Tarif in IOP update else insert
      if (inEmsp) {
        await Logging.logInfo({
          tenantID: tenant.id,
          user: loggedUser, module: MODULE_NAME, method: 'updateInsertTariffRoaming',
          message: `Update Pricing '${pricing.id}' in IOP System`,
          action: action,
          detailedMessages: { pricing }
        });
        // update Tariff in IOP
        await ocpiClient.patchTariff(pricing);
      } else {
        await Logging.logInfo({
          tenantID: tenant.id,
          user: loggedUser, module: MODULE_NAME, method: 'handleUpdatePricingDefinition',
          message: `Insert Pricing '${pricing.id}' in IOP System`,
          action: action,
          detailedMessages: { pricing }
        });
        // Insert Tariff in eMsp System
        await ocpiClient.putTariff(pricing);
      }
      return true;
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'updateTariffRoaming',
        action,
        user: loggedUser,
        message: `Unable to Update/Insert tariff ${pricing.ocpiData.tariff.id} in IOP`,
        detailedMessages: { error: error.stack }
      });
      return inEmsp;
    }
  }

  private static async deleteTariffRoaming(tenant: Tenant, loggedUser: UserToken,
      pricing: PricingDefinition, action: ServerAction) {
    // delete Tariff in IOP
    try {
      const ocpiClient = await OCPIClientFactory.getAvailableOcpiClient(tenant, OCPIRole.CPO) as CpoOCPIClient;
      if (ocpiClient) {
        await ocpiClient.deleteTariff(pricing);
      }
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'deleteTariffRoaming',
        action,
        user: loggedUser,
        message: `Unable to delete tariff ${pricing.ocpiData.tariff.id} in IOP`,
        detailedMessages: { error: error.stack }
      });
    }
  }


  private static async getComplientPricingDefinitions(pricingDefinitions: PricingDefinition[],connector : Connector,chargingStation:ChargingStation) {
  }

  private static async processPricingdefinitionsFacade(tenant :Tenant,entityType:PricingEntity, entityID: string , roaming = true) {
    const chargingStations = await PricingStorage.getPricingDefinitions(tenant ,{ roaming : roaming , entityType, entityID },{ limit:1000, skip:0 });
    const date = new Date();
    const noneExpired = chargingStations.result.filter((pricing) =>
      PricingService.checkPricingDefifnitionExpiration(pricing) === false);
    const currentTime = (date.getHours() * 3600) + (date.getHours() * 60) + (date.getSeconds());
    console.log('----------------------------this time :',currentTime);
    const sortedPricings = Utils.sortPricingDefitionsByRestrection(noneExpired).filter(
      (pricing) => ((pricing.restrictions?.timeFrom) && ((Utils.convertString2TimeFromMidnight(pricing.restrictions?.timeFrom)) >= currentTime))
      || (!pricing.restrictions)
      || ((pricing.restrictions?.timeFrom) && ((Utils.convertString2TimeFromMidnight(pricing.restrictions?.timeFrom)) <= currentTime) && ((Utils.convertString2TimeFromMidnight(pricing.restrictions?.timeTo)) >= currentTime))
    );
    return sortedPricings;
  }

  private static checkPricingDefifnitionExpiration(pricing:PricingDefinition) {
    let expired = false;
    const date = new Date();
    console.log('------------here----------------------',pricing.staticRestrictions);
    if (((pricing.staticRestrictions?.validFrom) && (pricing.staticRestrictions?.validFrom > date)) || ((pricing.staticRestrictions?.validTo) && (pricing.staticRestrictions?.validTo < date))) {
      expired = true;
      console.log('-------------------------exipred------------------');
    }
    return expired;
  }
}

