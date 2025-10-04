/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { RESTServerRoute, ServerAction } from '../../../../../types/Server';
import express, { NextFunction, Request, Response } from 'express';

import AssetService from '../../service/AssetService';
import BillingService from '../../service/BillingService';
import CarService from '../../service/CarService';
import ChargingStationService from '../../service/ChargingStationService';
import CompanyService from '../../service/CompanyService';
import RouterUtils from '../../../../../utils/RouterUtils';
import SiteAreaService from '../../service/SiteAreaService';
import SiteService from '../../service/SiteService';
import { StatusCodes } from 'http-status-codes';
import TenantService from '../../service/TenantService';
import PricingService from '../../service/PricingService';
import UserService from '../../service/UserService';
import TransactionService from '../../service/TransactionService';
import UserStorage from '../../../../../storage/mongodb/UserStorage';
import TenantStorage from '../../../../../storage/mongodb/TenantStorage';
import Utils from '../../../../../utils/Utils';

export default class UtilRouter {
  private router: express.Router;

  public constructor() {
    this.router = express.Router();
  }

  public buildRoutes(): express.Router {
    this.buildRoutePing();
    this.buildRouteGetCarCatalogImage();
    this.buildRouteGetAssetImage();
    this.buildRouteGetCompanyLogo();
    this.buildRouteGetCompanyFavicon();
    this.buildRouteGetCompanyColors();
    this.buildRouteGetSiteAreaImage();
    this.buildRouteChargingStationDownloadFirmware();
    this.buildRouteGetSiteImage();
    this.buildRouteGetTenantLogo();
    this.buildRouteGetTenantEmailLogo();
    this.buildRouteBillingRefreshAccount();
    this.buildRouteBillingActivateAccount();
    this.buildRouteGetTenantFavicon();
    this.buildRouteGetTenantColors();
    this.buildRouteTenantsList();
    this.buildRoutePricingDefinitionsQrCode();
    this.buildRouteChargingStationQrCode();
    this.buildRouteCreateUserQr();
    this.buildRouteTransactionQr();
    this.buildRouteUserQr();
    this.buildRouteGetUserByEmail();
    this.buildRouteChargingStationTariffID();
    return this.router;
  }

  private buildRoutePing(): void {
    this.router.get(`/${RESTServerRoute.REST_PING}`, (req: Request, res: Response, next: NextFunction) => {
      res.sendStatus(StatusCodes.OK);
      next();
    });
  }

  private buildRouteTransactionQr(): void {
    this.router.get(`/${RESTServerRoute.REST_TRANSACTION_QR}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(TransactionService.handleGetTransactionQr.bind(this), ServerAction.TRANSACTION, req, res, next);
    });
  }

  private buildRouteGetTenantLogo(): void {
    this.router.get(`/${RESTServerRoute.REST_TENANT_LOGO}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(TenantService.handleGetTenantLogo.bind(this), ServerAction.TENANT_LOGO, req, res, next);
    });
  }

  private buildRouteGetTenantEmailLogo(): void {
    this.router.get(`/${RESTServerRoute.REST_TENANT_EMAIL_LOGO}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(TenantService.handleGetTenantEmailLogo.bind(this), ServerAction.TENANT_LOGO, req, res, next);
    });
  }

  private buildRouteGetTenantFavicon(): void {
    this.router.get(`/${RESTServerRoute.REST_TENANT_FAVICON}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(TenantService.handleGetTenantFavicon.bind(this), ServerAction.TENANT_FAVICON, req, res, next);
    });
  }

  private buildRouteGetTenantColors(): void {
    this.router.get(`/${RESTServerRoute.REST_TENANT_COLORS}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(TenantService.handleGetTenantColors.bind(this), ServerAction.TENANT_COLORS, req, res, next);
    });
  }

  private buildRoutePricingDefinitionsQrCode(): void {
    this.router.get(`/${RESTServerRoute.REST_PRICING_DEFINITIONS_QR}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(PricingService.handleGetPricingDefinitionsQrCode.bind(this), ServerAction.PRICING_DEFINITIONS, req, res, next);
    });
  }

  private buildRouteTenantsList(): void {
    this.router.get(`/${RESTServerRoute.REST_TENANTS_LIST}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(TenantService.handleGetTenantsList.bind(this), ServerAction.TENANTS, req, res, next);
    });
  }

  private buildRouteGetCarCatalogImage(): void {
    this.router.get(`/${RESTServerRoute.REST_CAR_CATALOG_IMAGE}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(CarService.handleGetCarCatalogImage.bind(this), ServerAction.CAR_CATALOG_IMAGE, req, res, next);
    });
  }

  private buildRouteGetAssetImage(): void {
    this.router.get(`/${RESTServerRoute.REST_ASSET_IMAGE}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(AssetService.handleGetAssetImage.bind(this), ServerAction.ASSET_IMAGE, req, res, next);
    });
  }

  private buildRouteGetCompanyLogo(): void {
    this.router.get(`/${RESTServerRoute.REST_COMPANY_LOGO}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(CompanyService.handleGetCompanyLogo.bind(this), ServerAction.COMPANY_LOGO, req, res, next);
    });
  }

  private buildRouteGetCompanyFavicon(): void {
    this.router.get(`/${RESTServerRoute.REST_COMPANY_FAVICON}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(CompanyService.handleGetCompanyFavicon.bind(this), ServerAction.COMPANY_FAVICON, req, res, next);
    });
  }

  private buildRouteGetCompanyColors(): void {
    this.router.get(`/${RESTServerRoute.REST_COMPANY_COLORS}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(CompanyService.handleGetCompanyColors.bind(this), ServerAction.COMPANY_COLORS, req, res, next);
    });
  }

  private buildRouteGetSiteAreaImage(): void {
    this.router.get(`/${RESTServerRoute.REST_SITE_AREA_IMAGE}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(SiteAreaService.handleGetSiteAreaImage.bind(this), ServerAction.SITE_AREA_IMAGE, req, res, next);
    });
  }

  private buildRouteChargingStationDownloadFirmware(): void {
    this.router.get(`/${RESTServerRoute.REST_CHARGING_STATIONS_DOWNLOAD_FIRMWARE}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(ChargingStationService.handleGetFirmware.bind(this), ServerAction.FIRMWARE_DOWNLOAD, req, res, next);
    });
  }

  private buildRouteChargingStationQrCode(): void {
    this.router.get(`/${RESTServerRoute.REST_CHARGING_STATION_QR}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(ChargingStationService.handleGetChargingStationQrCode.bind(this), ServerAction.CHARGING_STATION, req, res, next);
    });
  }

  private buildRouteChargingStationTariffID(): void {
    this.router.get(`/${RESTServerRoute.REST_CHARGING_STATION_TARIFF_ID}`, (req: Request, res: Response, next: NextFunction) => {
      const { ChargingStationID, ConnectorID, Roaming } = req.query;
      void RouterUtils.handleRestServerAction(ChargingStationService.handleGetChargingStationTariffQr.bind(this), ServerAction.CHARGING_STATION, req, res, next);
    });
  }

  private buildRouteCreateUserQr(): void {
    this.router.post(`/${RESTServerRoute.REST_USERS_QR}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(UserService.handleCreateUserQrCode.bind(this), ServerAction.USER_CREATE, req, res, next);
    });
  }

  private buildRouteGetUserByEmail(): void {
    this.router.get(`/${RESTServerRoute.REST_USERS_EMAIL}`, async (req: Request, res: Response, next: NextFunction) => {
      const email = req.query.email as string;
      const tenantName = Utils.getTenantFromUrl(req);
      const tenant = await TenantStorage.getTenantBySubdomain(tenantName);
      if (!email) {
        return res.status(400).json({ error: 'Email is required' }); 
      }
      try {
        const user = await UserStorage.getUserByEmail(tenant, email);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
      } catch (error) {
        console.error('Error fetching user by email:', error);
        res.status(500).json({ error: 'An unexpected error occurred' });
        next(error);
      }
    });
  }
  
  
  private buildRouteUserQr(): void {
    this.router.get(`/${RESTServerRoute.REST_USER_QR}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(UserService.handleGetUserQr.bind(this), ServerAction.USER, req, res, next);
    });
  }

  private buildRouteGetSiteImage(): void {
    this.router.get(`/${RESTServerRoute.REST_SITE_IMAGE}`, (req: Request, res: Response, next: NextFunction) => {
      req.query.ID = req.params.id;
      void RouterUtils.handleRestServerAction(SiteService.handleGetSiteImage.bind(this), ServerAction.SITE_IMAGE, req, res, next);
    });
  }

  private buildRouteBillingRefreshAccount(): void {
    this.router.patch(`/${RESTServerRoute.REST_BILLING_ACCOUNT_REFRESH}`, (req: Request, res: Response, next: NextFunction) => {
      req.params.ID = req.params.id;
      void RouterUtils.handleRestServerAction(BillingService.handleRefreshAccount.bind(this), ServerAction.BILLING_ACCOUNT_ACTIVATE, req, res, next);
    });
  }

  private buildRouteBillingActivateAccount(): void {
    this.router.patch(`/${RESTServerRoute.REST_BILLING_ACCOUNT_ACTIVATE}`, (req: Request, res: Response, next: NextFunction) => {
      req.params.ID = req.params.id;
      void RouterUtils.handleRestServerAction(BillingService.handleActivateAccount.bind(this), ServerAction.BILLING_ACCOUNT_ACTIVATE, req, res, next);
    });
  }
}
