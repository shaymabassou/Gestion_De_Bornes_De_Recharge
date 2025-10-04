import { Action, AuthorizationFilter, Entity } from '../../../../types/Authorization';
import { BillingAccount, BillingInvoice, BillingTransfer } from '../../../../types/Billing';
import { BillingSettings, SettingDB } from '../../../../types/Setting';
import { Car, CarCatalog } from '../../../../types/Car';
import ChargingStation, { ChargePoint, ChargingStationTemplate, Command } from '../../../../types/ChargingStation';
import { EntityData, URLInfo } from '../../../../types/GlobalType';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import express ,{ NextFunction, Request, Response } from 'express';
import Tenant, { TenantComponents } from '../../../../types/Tenant';
import User, { UserRole, UserStatus } from '../../../../types/User';
import jwt from 'jsonwebtoken';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import Asset from '../../../../types/Asset';
import AssetStorage from '../../../../storage/mongodb/AssetStorage';
import AuthorizationService from './AuthorizationService';
import Authorizations from '../../../../authorization/Authorizations';
import AxiosFactory from '../../../../utils/AxiosFactory';
import { AxiosResponse } from 'axios';
import BillingStorage from '../../../../storage/mongodb/BillingStorage';
import CarStorage from '../../../../storage/mongodb/CarStorage';
import CentralSystemRestServiceConfiguration from '../../../../types/configuration/CentralSystemRestServiceConfiguration';
import { ChargingProfile } from '../../../../types/ChargingProfile';
import ChargingStationStorage from '../../../../storage/mongodb/ChargingStationStorage';
import ChargingStationTemplateStorage from '../../../../storage/mongodb/ChargingStationTemplateStorage';
import Company from '../../../../types/Company';
import CompanyStorage from '../../../../storage/mongodb/CompanyStorage';
import Constants from '../../../../utils/Constants';
import Cypher from '../../../../utils/Cypher';
import { DataResult } from '../../../../types/DataResult';
import { HttpSiteAreaCreateUpdateRequest } from '../../../../types/requests/HttpSiteAreaRequest';
import { HttpSiteCreateUpdateRequest } from '../../../../types/requests/HttpSiteRequest';
import { Log } from '../../../../types/Log';
import LogStorage from '../../../../storage/mongodb/LogStorage';
import Logging from '../../../../utils/Logging';
import LoggingHelper from '../../../../utils/LoggingHelper';
import OCPIEndpoint from '../../../../types/ocpi/OCPIEndpoint';
import OCPIEndpointStorage from '../../../../storage/mongodb/OCPIEndpointStorage';
import PDFDocument from 'pdfkit';
import PricingDefinition from '../../../../types/Pricing';
import PricingStorage from '../../../../storage/mongodb/PricingStorage';
import RegistrationToken from '../../../../types/RegistrationToken';
import RegistrationTokenStorage from '../../../../storage/mongodb/RegistrationTokenStorage';
import { ServerAction } from '../../../../types/Server';
import SettingStorage from '../../../../storage/mongodb/SettingStorage';
import Site from '../../../../types/Site';
import SiteArea from '../../../../types/SiteArea';
import SiteAreaStorage from '../../../../storage/mongodb/SiteAreaStorage';
import SiteStorage from '../../../../storage/mongodb/SiteStorage';
import { StatusCodes } from 'http-status-codes';
import Tag from '../../../../types/Tag';
import TagStorage from '../../../../storage/mongodb/TagStorage';
import Transaction from '../../../../types/Transaction';
import { TransactionInErrorType } from '../../../../types/InError';
import TransactionStorage from '../../../../storage/mongodb/TransactionStorage';
import UserStorage from '../../../../storage/mongodb/UserStorage';
import UserToken from '../../../../types/UserToken';
import Utils from '../../../../utils/Utils';
import _ from 'lodash';
import moment from 'moment';
import EmaidStorage from '../../../../storage/mongodb/EmaidStorage';
import Emaid from '../../../../types/Emaid';
import CertificateStorage from '../../../../storage/mongodb/CertificateStorage';
import { Certificate } from '../../../../types/Certificate';

const MODULE_NAME = 'UtilsService';

export default class UtilsService {
  public static getURLInfo(req: Request): URLInfo {
    return {
      httpFullUrl: req.originalUrl,
      httpUrl: req.url,
      httpMethod: req.method,
      group: Utils.getPerformanceRecordGroupFromURL(req.originalUrl),
    };
  }


  public static async assignCreatedUserToSites(tenant: Tenant, user: User, authorizationFilter?: AuthorizationFilter) {
    // Assign user to sites
    if (Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION)) {
      let siteIDs = [];
      if (!Utils.isEmptyArray(authorizationFilter?.filters?.siteIDs)) {
        siteIDs = authorizationFilter.filters.siteIDs;
      } else {
        // Assign user to all sites with auto-assign flag set
        const sites = await SiteStorage.getSites(tenant,
          { withAutoUserAssignment: true },
          Constants.DB_PARAMS_MAX_LIMIT
        );
        siteIDs = sites.result.map((site) => site.id);
      }
      await UserStorage.addSitesToUser(tenant, user.id, siteIDs);
    }
  }

  public static async checkReCaptcha(tenant: Tenant, action: ServerAction, method: string,
      centralSystemRestConfig: CentralSystemRestServiceConfiguration, captcha: string, remoteAddress: string): Promise<void> {
    const response = await UtilsService.performRecaptchaAPICall(tenant, centralSystemRestConfig, captcha, remoteAddress);
    if (!response.data.success) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        module: MODULE_NAME, action, method,
        message: 'The Captcha is invalid',
      });
    }
    if (response.data.score < centralSystemRestConfig.captchaScore) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        module: MODULE_NAME, action, method,
        message: `The Captcha score is too low, got ${response.data.score as string} but expected ${centralSystemRestConfig.captchaScore}`,
      });
    }
    await Logging.logDebug({
      tenantID: tenant?.id,
      module: MODULE_NAME, action, method,
      message: `The Captcha score is ${response.data.score as string} (score limit is ${centralSystemRestConfig.captchaScore})`,
    });
  }

  public static async checkAndGetChargingStationAuthorization(tenant: Tenant, userToken: UserToken, chargingStationID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<ChargingStation> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, chargingStationID, MODULE_NAME, 'checkAndGetChargingStationAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetChargingStationAuthorizations(tenant, userToken, { ID: chargingStationID }, authAction, entityData);
    // Get ChargingStation
    const chargingStation = await ChargingStationStorage.getChargingStation(tenant, chargingStationID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, chargingStation, `ChargingStation ID '${chargingStationID}' does not exist`,
      MODULE_NAME, 'checkAndGetChargingStationAuthorization', userToken);
    // Check deleted
    if (chargingStation?.deleted) {
      throw new AppError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        errorCode: StatusCodes.NOT_FOUND,
        message: `ChargingStation with ID '${chargingStation.id}' is logically deleted`,
        module: MODULE_NAME,
        method: 'checkAndGetChargingStationAuthorization',
        user: userToken,
      });
    }
    // Assign projected fields
    if (authorizations.projectFields) {
      chargingStation.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      chargingStation.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addChargingStationAuthorizations(tenant, userToken, chargingStation, authorizations);
    const authorized = AuthorizationService.canPerformAction(chargingStation, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.CHARGING_STATION,
        module: MODULE_NAME, method: 'checkAndGetChargingStationAuthorization',
      });
    }
    return chargingStation;
  }

  public static async checkAndGetChargingStationAuthorizationQr(tenant: Tenant, userToken: UserToken, chargingStationID: string, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<ChargingStation> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, chargingStationID, MODULE_NAME, 'checkAndGetChargingStationAuthorization', userToken);
    // Get ChargingStation
    const chargingStation = await ChargingStationStorage.getChargingStation(tenant, chargingStationID,
      {
        ...additionalFilters,
      },
    );
    UtilsService.assertObjectExists(action, chargingStation, `ChargingStation ID '${chargingStationID}' does not exist`,
      MODULE_NAME, 'checkAndGetChargingStationAuthorization', userToken);
    // Check deleted
    if (chargingStation?.deleted) {
      throw new AppError({
        ...LoggingHelper.getChargingStationProperties(chargingStation),
        errorCode: StatusCodes.NOT_FOUND,
        message: `ChargingStation with ID '${chargingStation.id}' is logically deleted`,
        module: MODULE_NAME,
        method: 'checkAndGetChargingStationAuthorization',
        user: userToken,
      });
    }
    // Add actions
    return chargingStation;
  }

  public static async checkAndGetChargingProfileAuthorization(tenant: Tenant, userToken: UserToken, chargingProfileID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<ChargingProfile> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, chargingProfileID, MODULE_NAME, 'checkAndGetChargingProfileAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetChargingProfileAuthorizations(tenant, userToken, { ID: chargingProfileID }, authAction, entityData);
    // Get charging profile
    const chargingProfile = await ChargingStationStorage.getChargingProfile(tenant, chargingProfileID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, chargingProfile, `Charging Profile ID '${chargingProfileID}' does not exist.`,
      MODULE_NAME, 'handleUpdateChargingProfile', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      chargingProfile.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      chargingProfile.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addChargingProfileAuthorizations(tenant, userToken, chargingProfile, authorizations);
    const authorized = AuthorizationService.canPerformAction(chargingProfile, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.CHARGING_PROFILE,
        module: MODULE_NAME, method: 'checkAndGetChargingStationAuthorization',
      });
    }
    return chargingProfile;
  }

  public static async checkAndGetTransactionAuthorization(tenant: Tenant, userToken: UserToken, transactionID: number, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Transaction> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, transactionID, MODULE_NAME, 'checkAndGetTransactionAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetTransactionAuthorizations(tenant, userToken, { ID: transactionID }, authAction, entityData);
    // Get ChargingStation
    const transaction = await TransactionStorage.getTransaction(tenant, transactionID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, transaction, `Transaction ID '${transactionID}' does not exist`,
      MODULE_NAME, 'checkAndGetTransactionAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      transaction.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      transaction.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addTransactionAuthorizations(tenant, userToken, transaction, authorizations);
    const authorized = AuthorizationService.canPerformAction(transaction, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.TRANSACTION,
        module: MODULE_NAME, method: 'checkAndGetTransactionAuthorization',
      });
    }
    return transaction;
  }

  public static async checkAndGetChargingStationTemplateAuthorization(tenant: Tenant, userToken: UserToken, chargingStationTemplateID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<ChargingStationTemplate> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, chargingStationTemplateID, MODULE_NAME, 'checkAndGetChargingStationTemplateAuthorization', userToken);
    // Get dynamic auth
    const authorizationFilter = await AuthorizationService.checkAndGetChargingStationTemplateAuthorizations(
      tenant, userToken, { ID: chargingStationTemplateID }, authAction, entityData);
    // Get one template
    const chargingStationTemplate = await ChargingStationTemplateStorage.getChargingStationTemplate(chargingStationTemplateID,
      {
        ...additionalFilters,
        ...authorizationFilter.filters
      },
      applyProjectFields ? authorizationFilter.projectFields : null
    );
    UtilsService.assertObjectExists(action, chargingStationTemplate, `ChargingStationTemplate ID '${chargingStationTemplateID}' does not exist`,
      MODULE_NAME, 'checkAndGetChargingStationTemplateAuthorization', userToken);
    return chargingStationTemplate;
  }

  public static async checkAndGetPricingDefinitionAuthorization(tenant: Tenant, userToken: UserToken, pricingDefinitionID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<PricingDefinition> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, pricingDefinitionID, MODULE_NAME, 'checkAndGetPricingDefinitionAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetPricingDefinitionAuthorizations(
      tenant, userToken, { ID: pricingDefinitionID }, authAction, entityData);
    // Get Pricing
    const pricingDefinition = await PricingStorage.getPricingDefinition(tenant, pricingDefinitionID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, pricingDefinition, `Pricing Model ID '${pricingDefinitionID}' does not exist`,
      MODULE_NAME, 'checkAndGetPricingDefinitionAuthorization', userToken);
    // Add actions
    await AuthorizationService.addPricingDefinitionAuthorizations(tenant, userToken, pricingDefinition, authorizations);
    // Assign projected fields
    if (authorizations.projectFields) {
      pricingDefinition.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      pricingDefinition.metadata = authorizations.metadata;
    }
    const authorized = AuthorizationService.canPerformAction(pricingDefinition, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.PRICING_DEFINITION,
        module: MODULE_NAME, method: 'checkAndGetPricingDefinitionAuthorization',
        value: pricingDefinitionID
      });
    }
    return pricingDefinition;
  }

  public static async checkAndGetRegistrationTokenAuthorization(tenant: Tenant, userToken: UserToken, registrationTokenID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<RegistrationToken> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, registrationTokenID, MODULE_NAME, 'checkAndGetRegistrationTokenAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetRegistrationTokenAuthorizations(
      tenant, userToken, { ID: registrationTokenID }, authAction, entityData);
    // Get Registration Token
    const registrationToken = await RegistrationTokenStorage.getRegistrationToken(tenant, registrationTokenID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, registrationToken, `Registration Token ID '${registrationTokenID}' does not exist`,
      MODULE_NAME, 'checkAndGetRegistrationTokenAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      registrationToken.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      registrationToken.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addRegistrationTokenAuthorizations(tenant, userToken, registrationToken, authorizations);
    const authorized = AuthorizationService.canPerformAction(registrationToken, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.REGISTRATION_TOKEN,
        module: MODULE_NAME, method: 'checkAndGetRegistrationTokenAuthorization',
        value: registrationTokenID,
      });
    }
    return registrationToken;
  }

  public static async checkAndGetCompanyAuthorization(tenant: Tenant, userToken: UserToken, companyID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Company> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, companyID, MODULE_NAME, 'checkAndGetCompanyAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetCompanyAuthorizations(
      tenant, userToken, { ID: companyID }, authAction, entityData);
    // Get Company
    const company = await CompanyStorage.getCompany(tenant, companyID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, company, `Company ID '${companyID}' does not exist`,
      MODULE_NAME, 'checkAndGetCompanyAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      company.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      company.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addCompanyAuthorizations(tenant, userToken, company, authorizations);
    const authorized = AuthorizationService.canPerformAction(company, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.COMPANY,
        module: MODULE_NAME, method: 'checkAndGetCompanyAuthorization',
        value: companyID,
        companyID: companyID,
      });
    }
    return company;
  }

  public static async checkAndGetUserAuthorization(tenant: Tenant, userToken: UserToken, userID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false, checkIssuer = true): Promise<User> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, userID, MODULE_NAME, 'checkAndGetUserAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetUserAuthorizations(tenant, userToken, { ID: userID }, authAction, entityData);
    // Get User
    const user = await UserStorage.getUser(tenant, userID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, user, `User ID '${userID}' does not exist`,
      MODULE_NAME, 'checkAndGetUserAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      user.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      user.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addUserAuthorizations(tenant, userToken, user, authorizations);
    const authorized = AuthorizationService.canPerformAction(user, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.USER,
        module: MODULE_NAME, method: 'checkAndGetUserAuthorization',
        value: userID
      });
    }
    return user;
  }

  public static async checkAndGetSiteAuthorization(tenant: Tenant, userToken: UserToken, siteID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Site> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, siteID, MODULE_NAME, 'checkAndGetSiteAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetSiteAuthorizations(tenant, userToken, { ID: siteID }, authAction, entityData);
    // Get Site
    const site = await SiteStorage.getSite(tenant, siteID,
      {
        ...additionalFilters,
        ...authorizations.filters,
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, site, `Site ID '${siteID}' does not exist`,
      MODULE_NAME, 'checkAndGetSiteAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      site.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      site.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addSiteAuthorizations(tenant, userToken, site, authorizations);
    const authorized = AuthorizationService.canPerformAction(site, authAction);
    if (!authorized) {
      throw new AppAuthError({
        ...LoggingHelper.getSiteProperties(site),
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.SITE,
        module: MODULE_NAME, method: 'checkAndGetSiteAuthorization',
        value: siteID,
      });
    }
    return site;
  }

  public static async checkAndGetAssetAuthorization(tenant: Tenant, userToken: UserToken, assetID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Asset> {
    // Check mandatory fields failsafe, should already be done in the json schema validation for each request
    UtilsService.assertIdIsProvided(action, assetID, MODULE_NAME, 'checkAndGetAssetAuthorization', userToken);
    // Retrieve authorization for action
    const authorizations = await AuthorizationService.checkAndGetAssetAuthorizations(
      tenant, userToken, authAction, { ID: assetID }, entityData);
    // Retrieve Asset from storage
    const asset = await AssetStorage.getAsset(tenant,
      assetID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    // Check object not empty
    UtilsService.assertObjectExists(action, asset, `Asset ID '${assetID}' cannot be retrieved`,
      MODULE_NAME, 'checkAndGetAssetAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      asset.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      asset.metadata = authorizations.metadata;
    }
    // Add entity authorization
    await AuthorizationService.addAssetAuthorizations(tenant, userToken, asset, authorizations);
    // Check authorization on retrieved entity
    const authorized = AuthorizationService.canPerformAction(asset, authAction);
    if (!authorized) {
      throw new AppAuthError({
        ...LoggingHelper.getAssetProperties(asset),
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.ASSET,
        module: MODULE_NAME, method: 'checkAndGetAssetAuthorization',
        value: assetID,
      });
    }
    return asset;
  }

  public static async checkAndGetLogAuthorization(tenant: Tenant, userToken: UserToken, logID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Log> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, logID, MODULE_NAME, 'checkAndGetLogAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetLoggingAuthorizations(
      tenant, userToken, { ID: logID }, authAction, entityData);
    // Get Log
    const log = await LogStorage.getLog(tenant, logID,
      {
        ...additionalFilters,
        ...authorizations.filters,
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, log, `Log ID '${logID}' does not exist`,
      MODULE_NAME, 'checkAndGetLogAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      log.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      log.metadata = authorizations.metadata;
    }
    // Add actions
    AuthorizationService.addLogAuthorizations(tenant, userToken, log, authorizations);
    const authorized = AuthorizationService.canPerformAction(log, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.LOGGING,
        module: MODULE_NAME, method: 'checkAndGetLogAuthorization',
        value: logID,
      });
    }
    return log;
  }

  public static async checkAndGetUserSitesAuthorization(tenant: Tenant, userToken: UserToken, user: User, siteIDs: string[],
      action: ServerAction, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Site[]> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, user.id, MODULE_NAME, 'checkUserSitesAuthorization', userToken);
    if (Utils.isEmptyArray(siteIDs)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The Site\'s IDs must be provided',
        module: MODULE_NAME, method: 'checkUserSitesAuthorization',
        user: userToken
      });
    }
    // Check dynamic auth for assignment
    const authorizations = await AuthorizationService.checkAssignUserSitesAuthorizations(
      tenant, action, userToken, { userID: user.id, siteIDs });
    // Get Sites
    let sites = (await SiteStorage.getSites(tenant,
      {
        siteIDs,
        ...additionalFilters,
        ...authorizations.filters,
      }, Constants.DB_PARAMS_MAX_LIMIT,
      applyProjectFields ? authorizations.projectFields : null
    )).result;
    // Keep the relevant result
    sites = sites.filter((site) => siteIDs.includes(site.id));
    // Must have the same result
    if (siteIDs.length !== sites.length) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: action === ServerAction.ADD_USERS_TO_SITE ? Action.ASSIGN : Action.UNASSIGN,
        entity: Entity.USER_SITE,
        module: MODULE_NAME, method: 'checkUserSitesAuthorization',
      });
    }
    await AuthorizationService.addUserSiteAuthToSitesAuthorizations(tenant, userToken, user, sites, authorizations);
    return sites;
  }

  public static async checkAndGetSiteUsersAuthorization(tenant: Tenant, userToken: UserToken, site: Site, userIDs: string[],
      action: ServerAction, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<User[]> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, site.id, MODULE_NAME, 'checkSiteUsersAuthorization', userToken);
    if (Utils.isEmptyArray(userIDs)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The User\'s IDs must be provided',
        module: MODULE_NAME, method: 'checkSiteUsersAuthorization',
        user: userToken
      });
    }
    // Check dynamic auth for assignment
    const authorizations = await AuthorizationService.checkAssignSiteUsersAuthorizations(
      tenant, action, userToken, { siteID: site.id, userIDs });
    // Get Users
    let users = (await UserStorage.getUsers(tenant,
      {
        userIDs,
        ...additionalFilters,
        ...authorizations.filters,
      }, Constants.DB_PARAMS_MAX_LIMIT,
      applyProjectFields ? authorizations.projectFields : null
    )).result;
    // Keep the relevant result
    users = users.filter((user) => userIDs.includes(user.id));
    // Must have the same result
    if (userIDs.length !== users.length) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: action === ServerAction.ADD_USERS_TO_SITE ? Action.ASSIGN_USERS_TO_SITE : Action.UNASSIGN_USERS_FROM_SITE,
        entity: Entity.SITE_USER,
        module: MODULE_NAME, method: 'checkAndGetSiteUsersAuthorization',
      });
    }
    await AuthorizationService.addSiteUserAuthToUsersAuthorizations(tenant, userToken, site, users, authorizations);
    return users;
  }

  public static async checkSiteAreaAssetsAuthorization(tenant: Tenant, userToken: UserToken, siteArea: SiteArea, assetIDs: string[],
      action: ServerAction, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Asset[]> {
    // Check Mandatory fields
    UtilsService.assertIdIsProvided(action, siteArea.id, MODULE_NAME, 'checkSiteAreaAssetsAuthorization', userToken);
    if (Utils.isEmptyArray(assetIDs)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The Asset\'s IDs must be provided',
        module: MODULE_NAME, method: 'checkSiteAreaAssetsAuthorization',
        user: userToken
      });
    }
    // Check dynamic auth
    const authorizations = await AuthorizationService.checkAndGetAssetsAuthorizations(
      tenant, userToken, Action.LIST);
    // Get Assets
    const assets = (await AssetStorage.getAssets(tenant,
      {
        assetIDs,
        ...additionalFilters,
        ...authorizations.filters,
      }, Constants.DB_PARAMS_MAX_LIMIT,
      applyProjectFields ? authorizations.projectFields : null
    )).result;
    // Must have the same result
    if (assetIDs.length !== assets.length) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: action === ServerAction.ADD_ASSET_TO_SITE_AREA ? Action.ASSIGN : Action.UNASSIGN,
        entity: Entity.ASSET,
        module: MODULE_NAME, method: 'checkSiteAreaAssetsAuthorization',
      });
    }
    return assets;
  }

  public static async checkSiteAreaChargingStationsAuthorization(tenant: Tenant, userToken: UserToken, siteArea: SiteArea, chargingStationIDs: string[],
      action: ServerAction, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<ChargingStation[]> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, siteArea.id, MODULE_NAME, 'checkSiteAreaChargingStationsAuthorization', userToken);
    if (Utils.isEmptyArray(chargingStationIDs)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The Charging Station\'s IDs must be provided',
        module: MODULE_NAME,
        method: 'checkSiteAreaChargingStationsAuthorization',
        user: userToken
      });
    }
    // Check dynamic auth
    const authorizations = await AuthorizationService.checkAndGetChargingStationsAuthorizations(tenant, userToken, Action.LIST);
    // Get Charging Stations
    const chargingStations = (await ChargingStationStorage.getChargingStations(tenant,
      {
        chargingStationIDs,
        ...additionalFilters,
        ...authorizations.filters,
      }, Constants.DB_PARAMS_MAX_LIMIT,
      applyProjectFields ? authorizations.projectFields : null
    )).result;
    // Must have the same result
    if (chargingStationIDs.length !== chargingStations.length) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: action === ServerAction.ADD_CHARGING_STATIONS_TO_SITE_AREA ? Action.ASSIGN : Action.UNASSIGN,
        entity: Entity.CHARGING_STATION,
        module: MODULE_NAME, method: 'checkSiteAreaChargingStationsAuthorization',
      });
    }
    return chargingStations;
  }

  public static async checkAndGetSiteAreaAuthorization(tenant: Tenant, userToken: UserToken, siteAreaID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<SiteArea> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, siteAreaID, MODULE_NAME, 'checkAndGetSiteAreaAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetSiteAreaAuthorizations(
      tenant, userToken, { ID: siteAreaID }, authAction, entityData);
    // Get SiteArea & check it exists
    const siteArea = await SiteAreaStorage.getSiteArea(tenant, siteAreaID,
      {
        ...additionalFilters,
        ...authorizations.filters,
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, siteArea, `Site Area ID '${siteAreaID}' does not exist`,
      MODULE_NAME, 'checkAndGetSiteAreaAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      siteArea.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      siteArea.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addSiteAreaAuthorizations(tenant, userToken, siteArea, authorizations);
    const authorized = AuthorizationService.canPerformAction(siteArea, authAction);
    if (!authorized) {
      throw new AppAuthError({
        ...LoggingHelper.getSiteAreaProperties(siteArea),
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.SITE_AREA,
        module: MODULE_NAME, method: 'checkAndGetSiteAreaAuthorization',
        value: siteAreaID,
      });
    }
    return siteArea;
  }

  public static async checkAndGetCarAuthorization(tenant: Tenant, userToken: UserToken, carID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Car> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, carID, MODULE_NAME, 'checkAndGetCarAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetCarAuthorizations(
      tenant, userToken, { ID: carID }, authAction, entityData);
    // Get Car
    const car = await CarStorage.getCar(tenant, carID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, car, `Car ID '${carID}' does not exist`,
      MODULE_NAME, 'checkAndGetCarAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      car.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      car.metadata = authorizations.metadata;
    }
    // Add Actions
    await AuthorizationService.addCarAuthorizations(tenant, userToken, car, authorizations);
    const authorized = AuthorizationService.canPerformAction(car, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.CAR,
        module: MODULE_NAME, method: 'checkAndGetCarAuthorization',
        value: carID
      });
    }
    return car;
  }

  public static async checkAndGetCarCatalogAuthorization(tenant: Tenant, userToken: UserToken, carCatalogID: number, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<CarCatalog> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, carCatalogID, MODULE_NAME, 'checkAndGetCarCatalogAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetCarCatalogAuthorizations(
      tenant, userToken, { ID: carCatalogID }, authAction, entityData);
    // Get the car
    const carCatalog = await CarStorage.getCarCatalog(carCatalogID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    // Check it exists
    UtilsService.assertObjectExists(action, carCatalog, `Car Catalog ID '${carCatalogID}' does not exist`,
      MODULE_NAME, 'checkAndGetCarCatalogAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      carCatalog.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      carCatalog.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addCarCatalogAuthorizations(tenant, userToken, carCatalog, authorizations);
    const authorized = AuthorizationService.canPerformAction(carCatalog, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.CAR_CATALOG,
        module: MODULE_NAME, method: 'checkAndGetCarCatalogAuthorization',
        value: carCatalogID.toString(),
      });
    }
    return carCatalog;
  }

  public static async checkAndGetSettingAuthorization(tenant: Tenant, userToken: UserToken, settingID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<SettingDB> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, settingID, MODULE_NAME, 'checkAndGetSettingAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetSettingAuthorizations(
      tenant, userToken, { ID: settingID }, authAction, entityData);
    // Get Setting
    let setting;
    if (additionalFilters?.identifier) {
      setting = await SettingStorage.getSettingByIdentifier(tenant, settingID,
        applyProjectFields ? authorizations.projectFields : null
      );
    } else {
      setting = await SettingStorage.getSetting(tenant, settingID,
        applyProjectFields ? authorizations.projectFields : null
      );
    }

    UtilsService.assertObjectExists(action, setting, `Setting '${settingID}' does not exist`,
      MODULE_NAME, 'checkAndGetSettingAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      setting.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      setting.metadata = authorizations.metadata;
    }
    // Add Actions
    await AuthorizationService.addSettingAuthorizations(tenant, userToken, setting, authorizations);
    const authorized = AuthorizationService.canPerformAction(setting, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.SETTING,
        module: MODULE_NAME, method: 'checkAndGetSettingAuthorization',
        value: settingID
      });
    }
    return setting;
  }

  public static async checkAndGetOCPIEndpointAuthorization(tenant: Tenant, userToken: UserToken, ocpiEndpointID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<OCPIEndpoint> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, ocpiEndpointID, MODULE_NAME, 'checkAndGetOCPIEndpointAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetOCPIEndpointAuthorizations(
      tenant, userToken, { ID: ocpiEndpointID }, authAction, entityData);
    // Get OCPI endpoint
    const ocpiEndpoint = await OCPIEndpointStorage.getOcpiEndpoint(tenant, ocpiEndpointID,
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, ocpiEndpoint, `OCPIEndpoint '${ocpiEndpointID}' does not exist`,
      MODULE_NAME, 'checkAndGetOCPIEndpointAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      ocpiEndpoint.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      ocpiEndpoint.metadata = authorizations.metadata;
    }
    // Add Actions
    await AuthorizationService.addOCPIEndpointAuthorizations(tenant, userToken, ocpiEndpoint, authorizations);
    const authorized = AuthorizationService.canPerformAction(ocpiEndpoint, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.OCPI_ENDPOINT,
        module: MODULE_NAME, method: 'checkAndGetOCPIEndpointAuthorization',
        value: ocpiEndpointID
      });
    }
    return ocpiEndpoint;
  }

  // This function is tailored for SETTING authorization, do not use it for "general" entities !
  public static async checkAndGetBillingSettingAuthorization(tenant: Tenant, userToken: UserToken, billingSettingID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<BillingSettings> {
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetSettingAuthorizations(tenant, userToken, { ID: billingSettingID }, authAction, entityData);
    // Get the entity from storage
    const billingSetting = await SettingStorage.getBillingSetting(
      tenant,
      applyProjectFields ? authorizations.projectFields : null
    );
    // Check it exists
    UtilsService.assertObjectExists(action, billingSetting, `Billing setting for tenantID '${tenant.id}' does not exist`,
      MODULE_NAME, 'checkAndGetBillingSettingAuthorization', userToken);
    // Assign projected fields
    if (applyProjectFields && authorizations.projectFields) {
      billingSetting.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      billingSetting.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addSettingAuthorizations(tenant, userToken, billingSetting, authorizations);
    const authorized = AuthorizationService.canPerformAction(billingSetting, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.SETTING,
        module: MODULE_NAME, method: 'checkAndGetBillingSettingAuthorization',
      });
    }
    return billingSetting;
  }

  public static async checkAndGetInvoiceAuthorization(tenant: Tenant, userToken: UserToken, invoiceID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<BillingInvoice> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, invoiceID, MODULE_NAME, 'checkAndGetInvoiceAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetInvoiceAuthorizations(
      tenant, userToken, { ID: invoiceID }, authAction, entityData);
    // Get Invoice
    const invoice = await BillingStorage.getInvoice(tenant, invoiceID,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, invoice, `Invoice ID '${invoiceID}' does not exist`,
      MODULE_NAME, 'checkAndGetInvoiceAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields && applyProjectFields) {
      invoice.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      invoice.metadata = authorizations.metadata;
    }
    // Add Actions
    await AuthorizationService.addInvoiceAuthorizations(tenant, userToken, invoice, authorizations);
    const authorized = AuthorizationService.canPerformAction(invoice, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.INVOICE,
        module: MODULE_NAME, method: 'checkAndGetInvoiceAuthorization',
        value: invoiceID
      });
    }
    return invoice;
  }

  public static async checkAndGetTransferAuthorization(tenant: Tenant, userToken: UserToken, ID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<BillingTransfer> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, ID, MODULE_NAME, 'checkAndGetTransferAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetTransferAuthorizations(
      tenant, userToken, { ID }, authAction, entityData);
    // Get Invoice
    const transfer = await BillingStorage.getTransfer(tenant, ID,
      // TODO - authorizations
      //   {
      //     ...additionalFilters,
      //     ...authorizations.filters
      //   },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, transfer, `Transfer ID '${ID}' does not exist`,
      MODULE_NAME, 'checkAndGetTransferAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields && applyProjectFields) {
      transfer.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      transfer.metadata = authorizations.metadata;
    }
    // Add Actions
    await AuthorizationService.addTransferAuthorizations(tenant, userToken, transfer, authorizations);
    const authorized = AuthorizationService.canPerformAction(transfer, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.BILLING_TRANSFER,
        module: MODULE_NAME, method: 'checkAndGetTransferAuthorization',
        value: ID
      });
    }
    return transfer;
  }

  public static async checkAndGetTagAuthorization(tenant: Tenant, userToken: UserToken, tagID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Tag> {
    return UtilsService.checkAndGetTagByXXXAuthorization(tenant, userToken, tagID, TagStorage.getTag.bind(this),
      authAction, action, entityData, additionalFilters, applyProjectFields);
  }

  public static async checkAndGetCertificateAuthorization(tenant: Tenant, userToken: UserToken, certificateID: string, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Certificate> {
  return UtilsService.checkAndGetCertificateByXXXAuthorization(tenant, userToken, certificateID, CertificateStorage.getCertificate.bind(this),
    authAction, action, entityData, additionalFilters, applyProjectFields);
}

// public static async checkAndGetCertificateById(tenant: Tenant, userToken: UserToken, certificateID: string, authAction: Action,
//   action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Certificate> {
// return UtilsService.checkAndGetCertificateByXXXAuthorization(tenant, userToken, certificateID, CertificateStorage.getCertificateById.bind(this),
//   authAction, action, entityData, additionalFilters, applyProjectFields);
// }
  
  public static async checkAndGetEmaidAuthorization(tenant: Tenant, userToken: UserToken, emaidID: string, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Emaid> {
  return UtilsService.checkAndGetEmaidByXXXAuthorization(tenant, userToken, emaidID, EmaidStorage.getEmaid.bind(this),
    authAction, action, entityData, additionalFilters, applyProjectFields);
}


  public static async checkAndGetTagByVisualIDAuthorization(tenant: Tenant, userToken: UserToken, tagID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Tag> {
    return UtilsService.checkAndGetTagByXXXAuthorization(tenant, userToken, tagID, TagStorage.getTagByVisualID.bind(this),
      authAction, action, entityData, additionalFilters, applyProjectFields);
  }

  public static async checkAndGetEmaidByVisualIDAuthorization(tenant: Tenant, userToken: UserToken, emaidID: string, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Emaid> {
  return UtilsService.checkAndGetEmaidByXXXAuthorization(tenant, userToken, emaidID, EmaidStorage.getEmaidByVisualID.bind(this),
    authAction, action, entityData, additionalFilters, applyProjectFields);
}

  public static async checkAndGetBillingAccountAuthorization(tenant: Tenant, userToken: UserToken, billingAccountID: string, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<BillingAccount> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, billingAccountID, MODULE_NAME, 'checkAndGetBillingAccountAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetBillingAccountAuthorizations(
      tenant, userToken, { ID: billingAccountID }, authAction, entityData);
    // Get Invoice
    const billingAccount = await BillingStorage.getAccountByID(tenant, billingAccountID,
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, billingAccount, `Billing account ID '${billingAccountID}' does not exist`,
      MODULE_NAME, 'checkAndGetBillingAccountAuthorization', userToken);
    // Assign projected fields
    if (authorizations.projectFields && applyProjectFields) {
      billingAccount.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      billingAccount.metadata = authorizations.metadata;
    }
    AuthorizationService.addAccountAuthorizations(tenant, userToken, billingAccount);
    const authorized = AuthorizationService.canPerformAction(billingAccount, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.INVOICE,
        module: MODULE_NAME, method: 'checkAndGetInvoiceAuthorization',
        value: billingAccountID
      });
    }
    return billingAccount;
  }

  public static sendEmptyDataResult(res: Response, next: NextFunction): void {
    res.json(Constants.DB_EMPTY_DATA_RESULT);
    next();
  }

  public static sendEmptyArray(res: Response, next: NextFunction): void {
    res.json([]);
    next();
  }

  public static async handleUnknownAction(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Action provided
    if (!action) {
      await Logging.logActionExceptionMessageAndSendResponse(
        null, new Error('No Action has been provided'), req, res, next);
    } else {
      await Logging.logActionExceptionMessageAndSendResponse(
        action, new Error(`The Action '${action}' does not exist`), req, res, next);
    }
  }

  public static getTransactionInErrorTypes(user: UserToken): TransactionInErrorType[] {
    // For only charging station in e-Mobility (not the ones from the roaming)
    const allTypes = [
      TransactionInErrorType.LONG_INACTIVITY,
      TransactionInErrorType.NEGATIVE_ACTIVITY,
      TransactionInErrorType.NEGATIVE_DURATION,
      TransactionInErrorType.LOW_DURATION,
      // TransactionInErrorType.OVER_CONSUMPTION, // To much time consuming + to check if calculation is right
      TransactionInErrorType.INVALID_START_DATE,
      TransactionInErrorType.NO_CONSUMPTION,
      TransactionInErrorType.LOW_CONSUMPTION,
      TransactionInErrorType.MISSING_USER
    ];
    if (Utils.isComponentActiveFromToken(user, TenantComponents.PRICING)) {
      allTypes.push(TransactionInErrorType.MISSING_PRICE);
    }
    if (Utils.isComponentActiveFromToken(user, TenantComponents.BILLING)) {
      allTypes.push(TransactionInErrorType.NO_BILLING_DATA);
    }
    return allTypes;
  }

  public static getAuthActionFromOCPPCommand(action: ServerAction, command: Command): Action {
    switch (command) {
      case Command.CLEAR_CACHE:
        return Action.CLEAR_CACHE;
      case Command.CHANGE_AVAILABILITY:
        return Action.CHANGE_AVAILABILITY;
      case Command.GET_CONFIGURATION:
        return Action.GET_CONFIGURATION;
      case Command.CHANGE_CONFIGURATION:
        return Action.CHANGE_CONFIGURATION;
      case Command.DATA_TRANSFER:
        return Action.TRIGGER_DATA_TRANSFER;
      case Command.REMOTE_STOP_TRANSACTION:
        return Action.REMOTE_STOP_TRANSACTION;
      case Command.REMOTE_START_TRANSACTION:
        return Action.REMOTE_START_TRANSACTION;
      case Command.GET_COMPOSITE_SCHEDULE:
        return Action.GET_COMPOSITE_SCHEDULE;
      case Command.GET_DIAGNOSTICS:
        return Action.GET_DIAGNOSTICS;
      case Command.UNLOCK_CONNECTOR:
        return Action.UNLOCK_CONNECTOR;
      case Command.UPDATE_FIRMWARE:
        return Action.UPDATE_FIRMWARE;
      case Command.RESET:
        return Action.RESET;
      default:
        throw new AppError({
          action,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `Could not map the OCPP Command '${command}' to an authorization action`,
          module: MODULE_NAME,
          method: 'getAuthActionFromOCPPCommand',
        });
    }
  }

  public static assertIdIsProvided(action: ServerAction, id: string | number, module: string, method: string, userToken: UserToken): void {
    if (!id) {
      // Object does not exist
      throw new AppError({
        action,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The ID must be provided',
        module: module,
        method: method,
        user: userToken
      });
    }
  }

  public static assertObjectExists(action: ServerAction, object: any, errorMsg: string, module: string, method: string, userToken?: UserToken): void {
    if (!object) {
      throw new AppError({
        action,
        errorCode: StatusCodes.NOT_FOUND,
        message: errorMsg,
        module: module,
        method: method,
        user: userToken
      });
    }
  }

  public static httpSortFieldsToMongoDB(httpSortFields: string): any {
    // Exist?
    if (httpSortFields) {
      const dbSortField: any = {};
      // Sanitize
      const sortFields = httpSortFields.split('|');
      // Build
      for (let sortField of sortFields) {
        // Order
        const order = sortField.startsWith('-') ? -1 : 1;
        // Remove the '-'
        if (order === -1) {
          sortField = sortField.substr(1);
        }
        // Check field ID
        if (sortField === 'id') {
          // In MongoDB it's '_id'
          sortField = '_id';
        }
        // Set
        dbSortField[sortField] = order;
      }
      return dbSortField;
    }
  }

  public static httpFilterProjectToArray(httpProjectFields: string): string[] {
    if (httpProjectFields) {
      return httpProjectFields.split('|');
    }
  }

  public static assertComponentIsActiveFromToken(userToken: UserToken, component: TenantComponents,
      action: Action, entity: Entity, module: string, method: string): void {
    // Check from token
    const active = Utils.isComponentActiveFromToken(userToken, component);
    if (!active) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        entity: entity, action: action,
        module: module, method: method,
        inactiveComponent: component,
        user: userToken
      });
    }
  }

  // public static verifyToken = (err: Error, req: Request, res: Response, next: NextFunction) => {
  //   const tokenSecret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY2YzVmM2I3ZjQ2ZDRmNjYwYzI1NTk0NSIsInJvbGUiOiJBIiwicm9sZXNBQ0wiOlsiYWRtaW4iXSwibmFtZSI6IkJPVVNTQUEiLCJtb2JpbGUiOiIxNTY0NTY0NTY0NTYiLCJlbWFpbCI6Im5pZGhhbC5ib3Vzc2FhQHdhdHR6aHViLmNvbSIsInRhZ0lEcyI6WyI3RTVENjgyNSJdLCJmaXJzdE5hbWUiOiJOaWRoYWwiLCJsb2NhbGUiOiJlbl9VUyIsImxhbmd1YWdlIjoiZW4iLCJjdXJyZW5jeSI6IkVVUiIsInRlbmFudElEIjoiNjZjNWYzNTVmNDZkNGY2NjBjMjU1OTBlIiwidGVuYW50TmFtZSI6InRlc3QiLCJ0ZW5hbnRTdWJkb21haW4iOiJ0ZXN0IiwidXNlckhhc2hJRCI6Ijk0ZDZjNWMzZGU5ZGExZDM0ZmQxYmEzZjcxZjQ3YzVhMjA3Mzk0MmIyZWE0NTlkNDE4ZWM3OTQ0ZDVkY2IzZDgiLCJ0ZW5hbnRIYXNoSUQiOiIxZjgxYmU2MWExNTA2ZjdjNDQyZjNlYTljODg4MTgzMTkwYWQ3NGZlY2ZhNjAzZjk0MjM0NTc2ODNiZTY0NWJhIiwic2NvcGVzIjpbIkFzc2V0OkNoZWNrQ29ubmVjdGlvbiIsIkFzc2V0OkNyZWF0ZSIsIkFzc2V0OkNyZWF0ZUNvbnN1bXB0aW9uIiwiQXNzZXQ6RGVsZXRlIiwiQXNzZXQ6SW5FcnJvciIsIkFzc2V0Okxpc3QiLCJBc3NldDpSZWFkIiwiQXNzZXQ6UmVhZENvbnN1bXB0aW9uIiwiQXNzZXQ6UmV0cmlldmVDb25zdW1wdGlvbiIsIkFzc2V0OlVwZGF0ZSIsIkJpbGxpbmc6Q2hlY2tDb25uZWN0aW9uIiwiQmlsbGluZzpDbGVhckJpbGxpbmdUZXN0RGF0YSIsIkJpbGxpbmdBY2NvdW50OkJpbGxpbmdBY2NvdW50T25ib2FyZCIsIkJpbGxpbmdBY2NvdW50OkNyZWF0ZSIsIkJpbGxpbmdBY2NvdW50OkRlbGV0ZSIsIkJpbGxpbmdBY2NvdW50Okxpc3QiLCJCaWxsaW5nQWNjb3VudDpSZWFkIiwiQmlsbGluZ0FjY291bnQ6VXBkYXRlIiwiQmlsbGluZ1RyYW5zZmVyOkJpbGxpbmdGaW5hbGl6ZVRyYW5zZmVyIiwiQmlsbGluZ1RyYW5zZmVyOkJpbGxpbmdTZW5kVHJhbnNmZXIiLCJCaWxsaW5nVHJhbnNmZXI6RG93bmxvYWQiLCJCaWxsaW5nVHJhbnNmZXI6TGlzdCIsIkJpbGxpbmdUcmFuc2ZlcjpSZWFkIiwiQ2FyOkNyZWF0ZSIsIkNhcjpEZWxldGUiLCJDYXI6TGlzdCIsIkNhcjpSZWFkIiwiQ2FyOlVwZGF0ZSIsIkNhckNhdGFsb2c6TGlzdCIsIkNhckNhdGFsb2c6UmVhZCIsIkNoYXJnaW5nUHJvZmlsZTpDcmVhdGUiLCJDaGFyZ2luZ1Byb2ZpbGU6RGVsZXRlIiwiQ2hhcmdpbmdQcm9maWxlOkxpc3QiLCJDaGFyZ2luZ1Byb2ZpbGU6UmVhZCIsIkNoYXJnaW5nUHJvZmlsZTpVcGRhdGUiLCJDaGFyZ2luZ1N0YXRpb246QXNzaWduVW5hc3NpZ25Vc2VyVG9DaGFyZ2luZ1N0YXRpb25Db25uZWN0b3IiLCJDaGFyZ2luZ1N0YXRpb246QXNzaWduVW5hc3NpZ25Vc2Vyc1RvQ29ubmVjdG9yIiwiQ2hhcmdpbmdTdGF0aW9uOkF1dGhvcml6ZSIsIkNoYXJnaW5nU3RhdGlvbjpDaGFuZ2VBdmFpbGFiaWxpdHkiLCJDaGFyZ2luZ1N0YXRpb246Q2hhbmdlQ29uZmlndXJhdGlvbiIsIkNoYXJnaW5nU3RhdGlvbjpDbGVhckNhY2hlIiwiQ2hhcmdpbmdTdGF0aW9uOkNsZWFyQ2hhcmdpbmdQcm9maWxlIiwiQ2hhcmdpbmdTdGF0aW9uOkNyZWF0ZSIsIkNoYXJnaW5nU3RhdGlvbjpEYXRhVHJhbnNmZXIiLCJDaGFyZ2luZ1N0YXRpb246RGVsZXRlIiwiQ2hhcmdpbmdTdGF0aW9uOkRlbGV0ZUNoYXJnaW5nUHJvZmlsZSIsIkNoYXJnaW5nU3RhdGlvbjpFeHBvcnQiLCJDaGFyZ2luZ1N0YXRpb246RXhwb3J0T0NQUFBhcmFtcyIsIkNoYXJnaW5nU3RhdGlvbjpFeHBvcnRPY3BpQ2RyIiwiQ2hhcmdpbmdTdGF0aW9uOkdlbmVyYXRlUXJDb2RlIiwiQ2hhcmdpbmdTdGF0aW9uOkdldEJvb3ROb3RpZmljYXRpb24iLCJDaGFyZ2luZ1N0YXRpb246R2V0Q29tcG9zaXRlU2NoZWR1bGUiLCJDaGFyZ2luZ1N0YXRpb246R2V0Q29uZmlndXJhdGlvbiIsIkNoYXJnaW5nU3RhdGlvbjpHZXRDb25uZWN0b3JRUkNvZGUiLCJDaGFyZ2luZ1N0YXRpb246R2V0RGlhZ25vc3RpY3MiLCJDaGFyZ2luZ1N0YXRpb246R2V0T0NQUFBhcmFtcyIsIkNoYXJnaW5nU3RhdGlvbjpHZXRTdGF0dXNOb3RpZmljYXRpb24iLCJDaGFyZ2luZ1N0YXRpb246SW5FcnJvciIsIkNoYXJnaW5nU3RhdGlvbjpMaW1pdFBvd2VyIiwiQ2hhcmdpbmdTdGF0aW9uOkxpc3QiLCJDaGFyZ2luZ1N0YXRpb246TWFpbnRhaW5QcmljaW5nRGVmaW5pdGlvbnMiLCJDaGFyZ2luZ1N0YXRpb246UHVzaFRyYW5zYWN0aW9uQ0RSIiwiQ2hhcmdpbmdTdGF0aW9uOlJlYWQiLCJDaGFyZ2luZ1N0YXRpb246UmVtb3RlU3RhcnRUcmFuc2FjdGlvbiIsIkNoYXJnaW5nU3RhdGlvbjpSZW1vdGVTdG9wVHJhbnNhY3Rpb24iLCJDaGFyZ2luZ1N0YXRpb246UmVzZXJ2ZU5vdyIsIkNoYXJnaW5nU3RhdGlvbjpSZXNldCIsIkNoYXJnaW5nU3RhdGlvbjpTZXRDaGFyZ2luZ1Byb2ZpbGUiLCJDaGFyZ2luZ1N0YXRpb246U3RhcnRUcmFuc2FjdGlvbiIsIkNoYXJnaW5nU3RhdGlvbjpTdG9wVHJhbnNhY3Rpb24iLCJDaGFyZ2luZ1N0YXRpb246VW5sb2NrQ29ubmVjdG9yIiwiQ2hhcmdpbmdTdGF0aW9uOlVwZGF0ZSIsIkNoYXJnaW5nU3RhdGlvbjpVcGRhdGVDaGFyZ2luZ1Byb2ZpbGUiLCJDaGFyZ2luZ1N0YXRpb246VXBkYXRlRmlybXdhcmUiLCJDaGFyZ2luZ1N0YXRpb246VXBkYXRlT0NQUFBhcmFtcyIsIkNoYXJnaW5nU3RhdGlvbjpWaWV3VXNlckRhdGEiLCJDb21wYW55OkNyZWF0ZSIsIkNvbXBhbnk6RGVsZXRlIiwiQ29tcGFueTpMaXN0IiwiQ29tcGFueTpSZWFkIiwiQ29tcGFueTpVcGRhdGUiLCJDb25uZWN0aW9uOkNyZWF0ZSIsIkNvbm5lY3Rpb246RGVsZXRlIiwiQ29ubmVjdGlvbjpMaXN0IiwiQ29ubmVjdGlvbjpSZWFkIiwiQ29ubmVjdG9yOkFzc2lnblVuYXNzaWduVXNlcnNUb0Nvbm5lY3RvciIsIkNvbm5lY3RvcjpSZW1vdGVTdGFydFRyYW5zYWN0aW9uIiwiQ29ubmVjdG9yOlJlbW90ZVN0b3BUcmFuc2FjdGlvbiIsIkNvbm5lY3RvcjpTdGFydFRyYW5zYWN0aW9uIiwiQ29ubmVjdG9yOlN0b3BUcmFuc2FjdGlvbiIsIkNvbm5lY3RvcjpWaWV3VXNlckRhdGEiLCJDb25zdW1wdGlvbjpHZXRBZHZlbmlyQ29uc3VtcHRpb24iLCJDb25zdW1wdGlvbjpMaXN0IiwiQ29uc3VtcHRpb246UmVhZCIsIkludm9pY2U6RG93bmxvYWQiLCJJbnZvaWNlOkxpc3QiLCJJbnZvaWNlOlJlYWQiLCJMb2dnaW5nOkV4cG9ydCIsIkxvZ2dpbmc6TGlzdCIsIkxvZ2dpbmc6UmVhZCIsIk5vdGlmaWNhdGlvbjpDcmVhdGUiLCJPY3BpRW5kcG9pbnQ6Q3JlYXRlIiwiT2NwaUVuZHBvaW50OkRlbGV0ZSIsIk9jcGlFbmRwb2ludDpHZW5lcmF0ZUxvY2FsVG9rZW4iLCJPY3BpRW5kcG9pbnQ6TGlzdCIsIk9jcGlFbmRwb2ludDpQaW5nIiwiT2NwaUVuZHBvaW50OlJlYWQiLCJPY3BpRW5kcG9pbnQ6UmVnaXN0ZXIiLCJPY3BpRW5kcG9pbnQ6VHJpZ2dlckpvYiIsIk9jcGlFbmRwb2ludDpVcGRhdGUiLCJPaWNwRW5kcG9pbnQ6Q3JlYXRlIiwiT2ljcEVuZHBvaW50OkRlbGV0ZSIsIk9pY3BFbmRwb2ludDpMaXN0IiwiT2ljcEVuZHBvaW50OlBpbmciLCJPaWNwRW5kcG9pbnQ6UmVhZCIsIk9pY3BFbmRwb2ludDpSZWdpc3RlciIsIk9pY3BFbmRwb2ludDpUcmlnZ2VySm9iIiwiT2ljcEVuZHBvaW50OlVwZGF0ZSIsIlBheW1lbnRNZXRob2Q6Q3JlYXRlIiwiUGF5bWVudE1ldGhvZDpEZWxldGUiLCJQYXltZW50TWV0aG9kOkxpc3QiLCJQYXltZW50TWV0aG9kOlJlYWQiLCJQcmljaW5nOlJlYWQiLCJQcmljaW5nOlVwZGF0ZSIsIlByaWNpbmdEZWZpbml0aW9uOkNyZWF0ZSIsIlByaWNpbmdEZWZpbml0aW9uOkRlbGV0ZSIsIlByaWNpbmdEZWZpbml0aW9uOkxpc3QiLCJQcmljaW5nRGVmaW5pdGlvbjpSZWFkIiwiUHJpY2luZ0RlZmluaXRpb246VXBkYXRlIiwiUmVnaXN0cmF0aW9uVG9rZW46Q3JlYXRlIiwiUmVnaXN0cmF0aW9uVG9rZW46RGVsZXRlIiwiUmVnaXN0cmF0aW9uVG9rZW46TGlzdCIsIlJlZ2lzdHJhdGlvblRva2VuOlJlYWQiLCJSZWdpc3RyYXRpb25Ub2tlbjpSZXZva2UiLCJSZWdpc3RyYXRpb25Ub2tlbjpVcGRhdGUiLCJSZXBvcnQ6UmVhZCIsIlNldHRpbmc6Q3JlYXRlIiwiU2V0dGluZzpEZWxldGUiLCJTZXR0aW5nOkxpc3QiLCJTZXR0aW5nOlJlYWQiLCJTZXR0aW5nOlVwZGF0ZSIsIlNpdGU6QXNzaWduVW5hc3NpZ25Vc2VycyIsIlNpdGU6Q3JlYXRlIiwiU2l0ZTpEZWxldGUiLCJTaXRlOkV4cG9ydE9DUFBQYXJhbXMiLCJTaXRlOkdlbmVyYXRlUXJDb2RlIiwiU2l0ZTpMaXN0IiwiU2l0ZTpNYWludGFpblByaWNpbmdEZWZpbml0aW9ucyIsIlNpdGU6UmVhZCIsIlNpdGU6VXBkYXRlIiwiU2l0ZUFyZWE6QXNzaWduQXNzZXRzIiwiU2l0ZUFyZWE6QXNzaWduQ2hhcmdpbmdTdGF0aW9ucyIsIlNpdGVBcmVhOkNyZWF0ZSIsIlNpdGVBcmVhOkRlbGV0ZSIsIlNpdGVBcmVhOkV4cG9ydE9DUFBQYXJhbXMiLCJTaXRlQXJlYTpHZW5lcmF0ZVFyQ29kZSIsIlNpdGVBcmVhOkxpc3QiLCJTaXRlQXJlYTpSZWFkIiwiU2l0ZUFyZWE6UmVhZEFzc2V0cyIsIlNpdGVBcmVhOlJlYWRDaGFyZ2luZ1N0YXRpb25zRnJvbVNpdGVBcmVhIiwiU2l0ZUFyZWE6VW5hc3NpZ25Bc3NldHMiLCJTaXRlQXJlYTpVbmFzc2lnbkNoYXJnaW5nU3RhdGlvbnMiLCJTaXRlQXJlYTpVcGRhdGUiLCJTaXRlVXNlcjpBc3NpZ25Vc2Vyc1RvU2l0ZSIsIlNpdGVVc2VyOkxpc3QiLCJTaXRlVXNlcjpSZWFkIiwiU2l0ZVVzZXI6VW5hc3NpZ25Vc2Vyc0Zyb21TaXRlIiwiU2l0ZVVzZXI6VXBkYXRlIiwiU21hcnRDaGFyZ2luZzpDaGVja0Nvbm5lY3Rpb24iLCJTb3VyY2U6TGlzdCIsIlN0YXRpc3RpYzpFeHBvcnQiLCJTdGF0aXN0aWM6UmVhZCIsIlRhZzpDcmVhdGUiLCJUYWc6RGVsZXRlIiwiVGFnOkV4cG9ydCIsIlRhZzpJbXBvcnQiLCJUYWc6TGlzdCIsIlRhZzpSZWFkIiwiVGFnOlRhZ3NHZXRFbXNwIiwiVGFnOlVwZGF0ZSIsIlRheDpMaXN0IiwiVGVuYW50OlJlYWQiLCJUZW5hbnQ6VXBkYXRlIiwiVHJhbnNhY3Rpb246RGVsZXRlIiwiVHJhbnNhY3Rpb246RXhwb3J0IiwiVHJhbnNhY3Rpb246RXhwb3J0Q29tcGxldGVkVHJhbnNhY3Rpb24iLCJUcmFuc2FjdGlvbjpFeHBvcnRPY3BpQ2RyIiwiVHJhbnNhY3Rpb246R2V0QWN0aXZlVHJhbnNhY3Rpb24iLCJUcmFuc2FjdGlvbjpHZXRBZHZlbmlyQ29uc3VtcHRpb24iLCJUcmFuc2FjdGlvbjpHZXRDaGFyZ2luZ1N0YXRpb25UcmFuc2FjdGlvbnMiLCJUcmFuc2FjdGlvbjpHZXRDb21wbGV0ZWRUcmFuc2FjdGlvbiIsIlRyYW5zYWN0aW9uOkdldFJlZnVuZFJlcG9ydCIsIlRyYW5zYWN0aW9uOkdldFJlZnVuZGFibGVUcmFuc2FjdGlvbiIsIlRyYW5zYWN0aW9uOkluRXJyb3IiLCJUcmFuc2FjdGlvbjpMaXN0IiwiVHJhbnNhY3Rpb246UHVzaFRyYW5zYWN0aW9uQ0RSIiwiVHJhbnNhY3Rpb246UmVhZCIsIlRyYW5zYWN0aW9uOlJlZnVuZFRyYW5zYWN0aW9uIiwiVHJhbnNhY3Rpb246UmVtb3RlU3RvcFRyYW5zYWN0aW9uIiwiVHJhbnNhY3Rpb246U3luY2hyb25pemVSZWZ1bmRlZFRyYW5zYWN0aW9uIiwiVHJhbnNhY3Rpb246VXBkYXRlIiwiVHJhbnNhY3Rpb246Vmlld1VzZXJEYXRhIiwiVXNlcjpBc3NpZ25VbmFzc2lnblNpdGVzIiwiVXNlcjpDcmVhdGUiLCJVc2VyOkRlbGV0ZSIsIlVzZXI6RXhwb3J0IiwiVXNlcjpJbXBvcnQiLCJVc2VyOkluRXJyb3IiLCJVc2VyOkxpc3QiLCJVc2VyOlJlYWQiLCJVc2VyOlN5bmNocm9uaXplQmlsbGluZ1VzZXIiLCJVc2VyOlVwZGF0ZSIsIlVzZXJTaXRlOkFzc2lnblNpdGVzVG9Vc2VyIiwiVXNlclNpdGU6TGlzdCIsIlVzZXJTaXRlOlJlYWQiLCJVc2VyU2l0ZTpVbmFzc2lnblNpdGVzRnJvbVVzZXIiLCJVc2VyU2l0ZTpVcGRhdGUiXSwic2l0ZXNBZG1pbiI6W10sInNpdGVzT3duZXIiOltdLCJzaXRlcyI6W10sImFjdGl2ZUNvbXBvbmVudHMiOlsib2NwaSIsInJlZnVuZCIsInByaWNpbmciLCJvcmdhbml6YXRpb24iLCJzdGF0aXN0aWNzIiwiYW5hbHl0aWNzIiwiYmlsbGluZyIsImJpbGxpbmdQbGF0Zm9ybSIsImFzc2V0Iiwic21hcnRDaGFyZ2luZyIsIm11bHRpcGxlVGFyaWZzIiwiY2FyIiwiY2FyQ29ubmVjdG9yIiwiYm9ybmVWSVAiXSwiaWF0IjoxNzI3MDg0NDE0LCJleHAiOjE3MjcxMjc2MTR9.K7h3_JkiKaLztizK66PKvWPPyd5p-HF-aUra6ODgH-M'
  //     console.log(`Incoming request: ${req.method} ${req.url}`);
  //     console.error(err.stack);
  //     const token = req.headers.authorization?.split(" ")[1];
      
  //     // Check if the token matches the hardcoded token
  //     if (token === tokenSecret) {
  //       next(); // Allow access
  //     } else {
  //       return res.status(401).json({ message: 'Unauthorized!' });
  //     }
  // };
  
  public static async exportToCSV(req: Request, res: Response, attachmentName: string, filteredRequest: any,
      handleGetData: (req: Request, filteredRequest: any) => Promise<DataResult<any>>,
      handleConvertToCSV: (req: Request, data: any[], writeHeader: boolean) => string): Promise<void> {
    // Force params
    req.query.Limit = Constants.EXPORT_PAGE_SIZE.toString();
    // Set the attachment name
    res.attachment(attachmentName);
    // Get the total number of Logs
    req.query.OnlyRecordCount = 'true';
    let data = await handleGetData(req, filteredRequest);
    let count = data.count;
    delete req.query.OnlyRecordCount;
    let skip = 0;
    // Limit the number of records
    if (count > Constants.EXPORT_RECORD_MAX_COUNT) {
      count = Constants.EXPORT_RECORD_MAX_COUNT;
    }
    // Handle closed socket
    let connectionClosed = false;
    req.socket.on('close', () => {
      connectionClosed = true;
    });
    do {
      // Check if the socket is closed and stop the process
      if (connectionClosed) {
        break;
      }
      // Get the data
      req.query.Skip = skip.toString();
      data = await handleGetData(req, filteredRequest);
      // Sanitize against csv formula injection
      data.result = await Utils.sanitizeCSVExport(data.result, req.tenant?.id);
      // Get CSV data
      const csvData = handleConvertToCSV(req, data.result, (skip === 0));
      // Send Transactions
      res.write(csvData);
      // Next page
      skip += Constants.EXPORT_PAGE_SIZE;
    } while (skip < count);
    // End of stream
    res.end();
  }

  public static async exportToPDF(req: Request, res: Response, attachmentName: string,
      handleGetData: (req: Request) => Promise<DataResult<any>>,
      handleConvertToPDF: (req: Request, pdfDocument: PDFKit.PDFDocument, data: any[]) => Promise<string>): Promise<void> {
    // Override
    req.query.Limit = Constants.EXPORT_PDF_PAGE_SIZE.toString();
    // Set the attachment name
    res.attachment(attachmentName);
    // Get the total number of Logs
    req.query.OnlyRecordCount = 'true';
    let data = await handleGetData(req);
    let count = data.count;
    delete req.query.OnlyRecordCount;
    let skip = 0;
    // Limit the number of records
    if (count > Constants.EXPORT_PDF_PAGE_SIZE) {
      count = Constants.EXPORT_PDF_PAGE_SIZE;
    }
    // Handle closed socket
    let connectionClosed = false;
    req.connection.on('close', () => {
      connectionClosed = true;
    });
    // Create the PDF
    const pdfDocument = new PDFDocument();
    pdfDocument.pipe(res);
    do {
      // Check if the socket is closed and stop the process
      if (connectionClosed) {
        break;
      }
      // Get the data
      req.query.Skip = skip.toString();
      data = await handleGetData(req);
      // Transform data
      await handleConvertToPDF(req, pdfDocument, data.result);
      // Next page
      skip += Constants.EXPORT_PAGE_SIZE;
    } while (skip < count);
    // Finish
    pdfDocument.end();
  }

  public static checkIfChargingProfileIsValid(chargingStation: ChargingStation, chargePoint: ChargePoint,
      filteredRequest: ChargingProfile, req: Request): void {
    if (filteredRequest.profile.chargingSchedule.chargingSchedulePeriod.length === 0) {
      throw new AppError({
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Charging Profile\'s schedule must not be empty',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    // Check End of Schedule <= 24h
    const endScheduleDate = new Date(new Date(filteredRequest.profile.chargingSchedule.startSchedule).getTime() +
      filteredRequest.profile.chargingSchedule.duration * 1000);
    if (!moment(endScheduleDate).isBefore(moment(filteredRequest.profile.chargingSchedule.startSchedule).add('1', 'd').add('1', 'm'))) {
      throw new AppError({
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Charging Profile\'s schedule should not exceed 24 hours',
        module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
        user: req.user.id
      });
    }
    // Check Max Limitation of each Schedule
    const maxAmpLimit = Utils.getChargingStationAmperageLimit(chargingStation, chargePoint, filteredRequest.connectorID);
    for (const chargingSchedulePeriod of filteredRequest.profile.chargingSchedule.chargingSchedulePeriod) {
      // Check Min
      if (chargingSchedulePeriod.limit < 0) {
        throw new AppError({
          action: ServerAction.CHARGING_PROFILE_UPDATE,
          errorCode: HTTPError.GENERAL_ERROR,
          message: 'Charging Schedule is below the min limitation (0A)',
          module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
          user: req.user.id,
          detailedMessages: { chargingSchedulePeriod }
        });
      }
      // Check Max
      if (chargingSchedulePeriod.limit > maxAmpLimit) {
        throw new AppError({
          action: ServerAction.CHARGING_PROFILE_UPDATE,
          errorCode: HTTPError.GENERAL_ERROR,
          message: `Charging Schedule is above the max limitation (${maxAmpLimit}A)`,
          module: MODULE_NAME, method: 'checkIfChargingProfileIsValid',
          user: req.user.id,
          detailedMessages: { chargingSchedulePeriod }
        });
      }
    }
  }

  public static checkIfChargePointValid(chargingStation: ChargingStation, chargePoint: ChargePoint, user: UserToken): void {
    const connectors = Utils.getConnectorsFromChargePoint(chargingStation, chargePoint);
    // Add helpers to check if charge point is valid
    let chargePointAmperage = 0;
    let chargePointPower = 0;
    for (const connector of connectors) {
      // Check if properties from charge point match the properties from the connector
      if (connector.voltage && chargePoint.voltage && connector.voltage !== chargePoint.voltage) {
        throw new AppError({
          action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
          errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
          message: 'Charge Point does not match the voltage of its connectors',
          module: MODULE_NAME, method: 'checkIfChargePointValid',
          user
        });
      }
      if (connector.numberOfConnectedPhase && chargePoint.numberOfConnectedPhase && connector.numberOfConnectedPhase !== chargePoint.numberOfConnectedPhase) {
        throw new AppError({
          action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
          errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
          message: 'Charge Point does not match the number of phases of its connectors',
          module: MODULE_NAME, method: 'checkIfChargePointValid',
          user
        });
      }
      if (connector.currentType && chargePoint.currentType && connector.currentType !== chargePoint.currentType) {
        throw new AppError({
          action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
          errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
          message: 'Charge Point does not match the currentType of its connectors',
          module: MODULE_NAME, method: 'checkIfChargePointValid',
          user
        });
      }
      // Check connectors power when it is shared within the charge point
      if (chargePoint.sharePowerToAllConnectors || chargePoint.cannotChargeInParallel) {
        if (connector.amperage && chargePoint.amperage && connector.amperage !== chargePoint.amperage) {
          throw new AppError({
            action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
            errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
            message: 'Charge Points amperage does not equal the amperage of the connectors (shared power between connectors)',
            module: MODULE_NAME, method: 'checkIfChargePointValid',
            user
          });
        }
        if (connector.power && chargePoint.power && connector.power !== chargePoint.power) {
          throw new AppError({
            action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
            errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
            message: 'Charge Points power does not equal the power of the connectors (shared power between connectors)',
            module: MODULE_NAME, method: 'checkIfChargePointValid',
            user
          });
        }
      } else {
        chargePointAmperage += connector.amperage;
        chargePointPower += connector.power;
      }
    }
    if (chargePointAmperage > 0 && chargePointAmperage !== chargePoint.amperage) {
      throw new AppError({
        action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
        errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
        message: `Charge Points amperage ${chargePoint.amperage}A does not match the combined amperage of the connectors ${chargePointPower}A`,
        module: MODULE_NAME, method: 'checkIfChargePointValid',
        user
      });
    }
    if (chargePointPower > 0 && chargePointPower !== chargePoint.power) {
      throw new AppError({
        action: ServerAction.CHARGING_STATION_UPDATE_PARAMS,
        errorCode: HTTPError.CHARGE_POINT_NOT_VALID,
        message: `Charge Points power ${chargePoint.power}W does not match the combined power of the connectors ${chargePointPower}W`,
        module: MODULE_NAME, method: 'checkIfChargePointValid',
        user
      });
    }
  }

  public static checkIfPricingDefinitionValid(pricingDefinition: Partial<PricingDefinition>, req: Request): void {
    if (pricingDefinition.staticRestrictions?.validFrom && pricingDefinition.staticRestrictions?.validTo &&
      pricingDefinition.staticRestrictions.validFrom.getTime() > pricingDefinition.staticRestrictions.validTo.getTime()) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'The pricing definition validity start date cannot be after the end date',
        module: MODULE_NAME, method: 'checkIfPricingDefinitionValid',
        user: req.user.id
      });
    }
  }

  public static checkIfTenantValid(tenant: Partial<Tenant>, req: Request): void {
    if (tenant.components.oicp?.active && tenant.components.ocpi?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'OICP and OCPI Components cannot be both active',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.refund?.active && !tenant.components.pricing?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Refund cannot be active without the Pricing component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.billing?.active && !tenant.components.pricing?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Billing cannot be active without the Pricing component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.billingPlatform?.active && !tenant.components.billing?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Billing accounts cannot be active without the Billing component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.smartCharging?.active && !tenant.components.organization?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Smart Charging cannot be active without the Organization component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.asset?.active && !tenant.components.organization?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Asset cannot be active without the Organization component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
    if (tenant.components.carConnector?.active && !tenant.components.car?.active) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Car Connector cannot be active without the Car component',
        module: MODULE_NAME, method: 'checkIfTenantValid',
        user: req.user.id
      });
    }
  }

  public static checkIfUserValid(filteredRequest: Partial<User>, user: User, req: Request): void {
    const tenantID = req.user.tenantID;
    if (!tenantID) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'Tenant is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id
      });
    }
    // Update model?
    if (req.method !== 'POST' && !filteredRequest.id) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User ID is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id
      });
    }
    // Creation?
    if (req.method === 'POST') {
      if (!filteredRequest.role) {
        filteredRequest.role = UserRole.BASIC;
      }
    } else if (!Authorizations.isAdmin(req.user)) {
      filteredRequest.role = user.role;
    }
    if (req.method === 'POST' && !filteredRequest.status) {
      filteredRequest.status = UserStatus.BLOCKED;
    }
    // Creation?
    if ((filteredRequest.role !== UserRole.BASIC) && (filteredRequest.role !== UserRole.DEMO) && (filteredRequest.role !== UserRole.QRCODE) &&
      !Authorizations.isAdmin(req.user) && !Authorizations.isSuperAdmin(req.user)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: `Only Admins can assign the role '${Utils.getRoleNameFromRoleID(filteredRequest.role)}'`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    // Only Basic, Demo, Admin user other Tenants (!== default)
    if (tenantID !== 'default' && filteredRequest.role && filteredRequest.role === UserRole.SUPER_ADMIN) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User cannot have the Super Admin role in this Tenant',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    // Only Admin and Super Admin can use role different from Basic
    if ((filteredRequest.role === UserRole.ADMIN || filteredRequest.role === UserRole.SUPER_ADMIN) &&
      !Authorizations.isAdmin(req.user) && !Authorizations.isSuperAdmin(req.user)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User without role Admin or Super Admin tried to ${filteredRequest.id ? 'update' : 'create'} an User with the '${Utils.getRoleNameFromRoleID(filteredRequest.role)}' role`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (req.method === 'POST' && !filteredRequest.name) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Last Name is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (req.method === 'POST' && !filteredRequest.email) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Email is mandatory',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    if (req.method === 'POST' && !Utils.isUserEmailValid(filteredRequest.email)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: `User Email '${filteredRequest.email}' is not valid`,
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
    // Check for password validity if user's password is updated
    if (req.method === 'PUT' && filteredRequest.password && !Utils.isPasswordValid(filteredRequest.password)) {
      throw new AppError({
        errorCode: HTTPError.GENERAL_ERROR,
        message: 'User Password is not valid',
        module: MODULE_NAME,
        method: 'checkIfUserValid',
        user: req.user.id,
        actionOnUser: filteredRequest.id
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public static async processSensitiveData(tenant: Tenant, currentProperties: object, newProperties: object): Promise<void> {
    // Process the sensitive data (if any)
    const sensitivePropertyNames: string[] = _.get(currentProperties, 'sensitiveData');
    if (sensitivePropertyNames) {
      if (!Array.isArray(sensitivePropertyNames)) {
        throw new AppError({
          errorCode: HTTPError.CYPHER_INVALID_SENSITIVE_DATA_ERROR,
          message: 'Unexpected situation - sensitiveData is not an array',
          module: MODULE_NAME,
          method: 'processSensitiveData'
        });
      }
      // Process sensitive properties
      for (const propertyName of sensitivePropertyNames) {
        // Get the sensitive property from the request
        const newValue = _.get(newProperties, propertyName);
        if (newValue && typeof newValue === 'string') {
          // Get the sensitive property from the DB
          const currentValue = _.get(currentProperties, propertyName);
          if (currentValue && typeof currentValue === 'string') {
            const currentHash = Utils.hash(currentValue);
            if (newValue !== currentHash) {
              // Yes: Encrypt
              _.set(newProperties, propertyName, await Cypher.encrypt(tenant, newValue));
            } else {
              // No: Put back the encrypted value
              _.set(newProperties, propertyName, currentValue);
            }
          } else {
            // Value in db is empty then encrypt
            _.set(newProperties, propertyName, await Cypher.encrypt(tenant, newValue));
          }
        } else {
          throw new AppError({
            errorCode: HTTPError.CYPHER_INVALID_SENSITIVE_DATA_ERROR,
            message: `The property '${propertyName}' is not set`,
            module: MODULE_NAME,
            method: 'processSensitiveData',
          });
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  public static hashSensitiveData(tenantID: string, properties: object): unknown {
    const sensitivePropertyNames: string[] = _.get(properties, 'sensitiveData');
    if (sensitivePropertyNames) {
      if (!Array.isArray(sensitivePropertyNames)) {
        throw new AppError({
          errorCode: HTTPError.CYPHER_INVALID_SENSITIVE_DATA_ERROR,
          message: 'Unexpected situation - sensitiveData is not an array',
          module: MODULE_NAME,
          method: 'hashSensitiveData'
        });
      }
      for (const propertyName of sensitivePropertyNames) {
        // Check that the property does exist otherwise skip to the next property
        if (_.has(properties, propertyName)) {
          const value = _.get(properties, propertyName);
          // If the value is undefined, null or empty then do nothing and skip to the next property
          if (value && typeof value === 'string') {
            // eslint-disable-next-line @typescript-eslint/ban-types
            _.set(properties, propertyName, Utils.hash(value));
          }
        }
      }
    }
    return properties;
  }

  private static async checkAndGetTagByXXXAuthorization(tenant: Tenant, userToken: UserToken, id: string,
      getTagByXXX: (tenant: Tenant, id: string, params: any, projectedFileds: string[]) => Promise<Tag>, authAction: Action,
      action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Tag> {
    // Check mandatory fields
    UtilsService.assertIdIsProvided(action, id, MODULE_NAME, 'checkAndGetTagByXXXAuthorization', userToken);
    // Get dynamic auth
    const authorizations = await AuthorizationService.checkAndGetTagAuthorizations(
      tenant, userToken, { ID: id }, authAction, entityData);
    // Get the Tag & check it exists
    const tag = await getTagByXXX(tenant, id,
      {
        ...additionalFilters,
        ...authorizations.filters
      },
      applyProjectFields ? authorizations.projectFields : null
    );
    UtilsService.assertObjectExists(action, tag, `Tag ID '${id}' does not exist`,
      MODULE_NAME, 'handleGetTag', userToken);
    // Assign projected fields
    if (authorizations.projectFields) {
      tag.projectFields = authorizations.projectFields;
    }
    // Assign Metadata
    if (authorizations.metadata) {
      tag.metadata = authorizations.metadata;
    }
    // Add actions
    await AuthorizationService.addTagAuthorizations(tenant, userToken, tag, authorizations);
    const authorized = AuthorizationService.canPerformAction(tag, authAction);
    if (!authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: userToken,
        action: authAction, entity: Entity.TAG,
        module: MODULE_NAME, method: 'checkAndGetTagByXXXAuthorization',
        value: id
      });
    }
    return tag;
  }


  private static async checkAndGetCertificateByXXXAuthorization(tenant: Tenant, userToken: UserToken, id: string,
    getCertificateByXXX: (tenant: Tenant, id: string, params: any, projectedFileds: string[]) => Promise<Certificate>, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Certificate> {
  // Check mandatory fields
  UtilsService.assertIdIsProvided(action, id, MODULE_NAME, 'checkAndGetCertificateByXXXAuthorization', userToken);
  // Get dynamic auth
  const authorizations = await AuthorizationService.checkAndGetCertificateAuthorizations(
    tenant, userToken, { ID: id }, authAction, entityData);
  // Get the Certificate & check it exists
  const certificate = await getCertificateByXXX(tenant, id,
    {
      ...additionalFilters,
      ...authorizations.filters
    },
    applyProjectFields ? authorizations.projectFields : null
  );
  UtilsService.assertObjectExists(action, certificate, `Certificate ID '${id}' does not exist`,
    MODULE_NAME, 'handleGetCertificate', userToken);
  // Assign projected fields
  if (authorizations.projectFields) {
    certificate.projectFields = authorizations.projectFields;
  }
  // Assign Metadata
  if (authorizations.metadata) {
    certificate.metadata = authorizations.metadata;
  }
  // Add actions
  await AuthorizationService.addCertificateAuthorizations(tenant, userToken, certificate, authorizations);
  const authorized = AuthorizationService.canPerformAction(certificate, authAction);
  if (!authorized) {
    throw new AppAuthError({
      errorCode: HTTPAuthError.FORBIDDEN,
      user: userToken,
      action: authAction, entity: Entity.CERTIFICATE,
      module: MODULE_NAME, method: 'checkAndGetCertificateByXXXAuthorization',
      value: id
    });
  }
  return certificate;
}




  private static async checkAndGetEmaidByXXXAuthorization(tenant: Tenant, userToken: UserToken, id: string,
    getEmaidByXXX: (tenant: Tenant, id: string, params: any, projectedFileds: string[]) => Promise<Emaid>, authAction: Action,
    action: ServerAction, entityData?: EntityData, additionalFilters: Record<string, any> = {}, applyProjectFields = false): Promise<Emaid> {
  // Check mandatory fields
  UtilsService.assertIdIsProvided(action, id, MODULE_NAME, 'checkAndGetEmaidByXXXAuthorization', userToken);
  // Get dynamic auth
  console.log("Dans checkAndGetEmaidByXXXAuthorization - Entité :", Entity.EMAID, "Action :", authAction, "Rôle :", userToken.role);
  const authorizations = await AuthorizationService.checkAndGetEmaidAuthorizations(
    tenant, userToken, { ID: id }, authAction, entityData);
    console.log("Résultat authorizations :", authorizations.authorized);
  // Get the Emaid & check it exists
  const emaid = await getEmaidByXXX(tenant, id,
    {
      ...additionalFilters,
      ...authorizations.filters
    },
    applyProjectFields ? authorizations.projectFields : null
  );
  UtilsService.assertObjectExists(action, emaid, `Emaid ID '${id}' does not exist`,
    MODULE_NAME, 'handleGetEmaid', userToken);
  // Assign projected fields
  if (authorizations.projectFields) {
    emaid.projectFields = authorizations.projectFields;
  }
  // Assign Metadata
  if (authorizations.metadata) {
    emaid.metadata = authorizations.metadata;
  }
  // Add actions
  await AuthorizationService.addEmaidAuthorizations(tenant, userToken, emaid, authorizations);
  const authorized = AuthorizationService.canPerformAction(emaid, authAction);
  if (!authorized) {
    throw new AppAuthError({
      errorCode: HTTPAuthError.FORBIDDEN,
      user: userToken,
      action: authAction, entity: Entity.EMAID,
      module: MODULE_NAME, method: 'checkAndGetEmaidByXXXAuthorization',
      value: id
    });
  }
  return emaid;
}





  private static async performRecaptchaAPICall(tenant: Tenant, centralSystemRestConfig: CentralSystemRestServiceConfiguration, captcha: string, remoteAddress: string)
      : Promise<AxiosResponse<any, any>> {
    const recaptchaURL = UtilsService.buildRecaptchaURL(centralSystemRestConfig.captchaSecretKey, captcha, remoteAddress);
    const axiosInstance = AxiosFactory.getAxiosInstance(tenant);
    let response = await axiosInstance.get(recaptchaURL);
    // Call not successful, attempt with alternative URL
    if (!response.data.success && centralSystemRestConfig.alternativeCaptchaSecretKey) {
      const alternativeRecaptchaURL = UtilsService.buildRecaptchaURL(centralSystemRestConfig.alternativeCaptchaSecretKey, captcha, remoteAddress);
      response = await axiosInstance.get(alternativeRecaptchaURL);
    }
    return response;
  }

  private static buildRecaptchaURL(captchaSecretKey: string, captcha: string, remoteAddress: string) {
    return `https://www.google.com/recaptcha/api/siteverify?secret=${captchaSecretKey}&response=${captcha}&remoteip=${remoteAddress}`;
  }
}
