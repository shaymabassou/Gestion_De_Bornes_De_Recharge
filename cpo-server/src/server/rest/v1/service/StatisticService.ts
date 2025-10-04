/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Action, AuthorizationFilter, Entity } from '../../../../types/Authorization';
import { NextFunction, Request, Response } from 'express';
import StatisticFilter, { ChargingStationStats, StatsDataCategory, StatsDataScope, StatsDataType, StatsGroupBy, UserStats } from '../../../../types/Statistic';
import Tenant, { TenantComponents } from '../../../../types/Tenant';

import AppAuthError from '../../../../exception/AppAuthError';
import AuthorizationService from './AuthorizationService';
import Authorizations from '../../../../authorization/Authorizations';
import { ChargingStationInErrorType } from '../../../../types/InError';
import ChargingStationStorage from '../../../../storage/mongodb/ChargingStationStorage';
import Constants from '../../../../utils/Constants';
import { HTTPAuthError } from '../../../../types/HTTPError';
import HttpStatisticsGetRequest from '../../../../types/requests/HttpStatisticRequest';
import { ServerAction } from '../../../../types/Server';
import { StatisticDataResult } from '../../../../types/DataResult';
import StatisticsStorage from '../../../../storage/mongodb/StatisticsStorage';
import StatisticsValidatorRest from '../validator/StatisticsValidatorRest';
import TagStorage from '../../../../storage/mongodb/TagStorage';
import TransactionStorage from '../../../../storage/mongodb/TransactionStorage';
import UserStorage from '../../../../storage/mongodb/UserStorage';
import UserToken from '../../../../types/UserToken';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
import moment from 'moment';
import EmaidStorage from '../../../../storage/mongodb/EmaidStorage';

const MODULE_NAME = 'StatisticService';

export default class StatisticService {
  public static async handleGetChargingStationConsumptionStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.LIST, Entity.STATISTIC, MODULE_NAME, 'handleGetChargingStationConsumptionStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getChargingStationStats(req.tenant, filter, StatsGroupBy.CONSUMPTION);
    // Convert
    const transactions = StatisticService.convertToGraphData(transactionStats, StatsDataCategory.CHARGING_STATION, filter.dataScope);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetChargingStationUsageStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetChargingStationUsageStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getChargingStationStats(
      req.tenant, filter, StatsGroupBy.USAGE);
    // Convert
    const transactions = StatisticService.convertToGraphData(transactionStats, StatsDataCategory.CHARGING_STATION, filter.dataScope);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetChargingStationInactivityStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetChargingStationInactivityStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getChargingStationStats(
      req.tenant, filter, StatsGroupBy.INACTIVITY);
    // Convert
    const transactions = StatisticService.convertToGraphData(transactionStats, StatsDataCategory.CHARGING_STATION, filter.dataScope);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetChargingStationTransactionsStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetChargingStationTransactionsStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getChargingStationStats(
      req.tenant, filter, StatsGroupBy.TRANSACTIONS);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.CHARGING_STATION, filter.dataScope);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetChargingStationPricingStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.LIST, Entity.STATISTIC, MODULE_NAME, 'handleGetChargingStationPricingStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getChargingStationStats(
      req.tenant, filter, StatsGroupBy.PRICING);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.CHARGING_STATION, filter.dataScope);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetUserConsumptionStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetUserConsumptionStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getUserStats(
      req.tenant, filter, StatsGroupBy.CONSUMPTION);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.USER);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetUserUsageStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetUserUsageStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getUserStats(
      req.tenant, filter, StatsGroupBy.USAGE);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.USER);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetUserInactivityStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetUserInactivityStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getUserStats(
      req.tenant, filter, StatsGroupBy.INACTIVITY);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.USER);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetUserTransactionsStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetUserTransactionsStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getUserStats(
      req.tenant, filter, StatsGroupBy.TRANSACTIONS);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.USER);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetUserPricingStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleGetUserPricingStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Get Stats
    const transactionStats = await StatisticsStorage.getUserStats(
      req.tenant, filter, StatsGroupBy.PRICING);
    // Convert
    const transactions = StatisticService.convertToGraphData(
      transactionStats, StatsDataCategory.USER);
    // Return data
    await StatisticService.buildAndReturnStatisticData(req, res, transactions, filteredRequest, authorizations, next);
  }

  public static async handleGetDashboardStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsGet(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);

    // Get user
    const users = await UserStorage.getUsers(req.tenant, { issuer: true }, Constants.DB_PARAMS_MAX_LIMIT);
    // convert users data to stats
    const userStats = {
      count: users.result.length,
      admin: users.result.filter((user) => user.role === 'A').length,
      basic: users.result.filter((user) => user.role === 'B').length,
      Demo: users.result.filter((user) => user.role === 'D').length,
      QRCODE: users.result.filter((user) => user.role === 'Q').length,
      activeUsers: users.result.filter((user) => user.status === 'A').length,
      inactiveUsers: users.result.filter((user) => user.status === 'I').length,
      pendingUsers: users.result.filter((user) => user.status === 'P').length,
      lockedUsers: users.result.filter((user) => user.status === 'L').length,
      suspendedUsers: users.result.filter((user) => user.status === 'L').length,
    };

    // Get badges
    const tags = await TagStorage.getTags(req.tenant, { issuer: true }, Constants.DB_PARAMS_MAX_LIMIT, ['id', 'active']);
    // convert badges data to stats
    const tagStats = {
      count: tags.result.length,
      active: tags.result.filter((tag) => tag.active).length,
      inactive: tags.result.filter((tag) => !tag.active).length,
    };

// Get badges
    const emaids = await EmaidStorage.getEmaids(req.tenant, { issuer: true }, Constants.DB_PARAMS_MAX_LIMIT, ['id', 'active']);
    // convert badges data to stats
    const emaidStats = {
      count: emaids.result.length,
      active: emaids.result.filter((emaid) => emaid.active).length,
      inactive: emaids.result.filter((emaid) => !emaid.active).length,
    };

    // Get All chargingStations
    const chargingStations = await ChargingStationStorage.getChargingStations(req.tenant,
      {
        issuer: true,
      },
      Constants.DB_PARAMS_MAX_LIMIT,
      ['id', 'inactive', 'connectorsStatus', 'WithNoSiteArea', 'WithSite', 'WithSiteArea', 'connectorsConsumption', 'public', 'ocppVersion', 'ocppProtocol', 'connectors.status', 'connectors.errorCode', 'connectors.currentTotalConsumptionWh']
    );

    // Get chargingStations In Error
    let errorType = [ChargingStationInErrorType.MISSING_SETTINGS, ChargingStationInErrorType.CONNECTION_BROKEN, ChargingStationInErrorType.CONNECTOR_ERROR];
    const chargingStationsInErrors = await ChargingStationStorage.getChargingStationsInError(req.tenant,
      {
        siteIDs: null,
        siteAreaIDs: null,
        errorType
      },
      Constants.DB_PARAMS_MAX_LIMIT
    );


    const inErrorStations = chargingStationsInErrors.result.reduce((station, currentStation) => {

      const hasLocation = station.find((location) => location.id === currentStation.id);
      if (!hasLocation) {
        station.push(currentStation);
      }
      return station;
    }, []);
    // convert chargingStations data to stats
    const chargingStationsStats = {
      count: chargingStations.result.length,
      connected: chargingStations.result.filter((chargingStation) => !chargingStation.inactive).length,
      disconnected: chargingStations.result.filter((chargingStation) => chargingStation.inactive).length,
      public: chargingStations.result.filter((chargingStation) => chargingStation.public).length,
      private: chargingStations.result.filter((chargingStation) => !chargingStation.public).length,
      inError: inErrorStations.length,
      available: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Available').length,
      preparing: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Preparing').length,
      suspended: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'SuspendedEVSE').length,
      charging: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Charging').length,
      occupied: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Occupied').length,
      finishing: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Finishing').length,
      reserved: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Reserved').length,
      unavailable: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Unavailable').length,
      faulted: chargingStations.result.flatMap((chargingStation) => (!chargingStation.inactive) ? chargingStation.connectors : null).filter((connector) => connector?.status === 'Faulted').length,
    };

    // Get badges
    const sessions = await TransactionStorage.getTransactions(req.tenant, { issuer: true }, Constants.DB_PARAMS_MAX_LIMIT);
    // convert badges data to stats
    const sessionsStats = {
      count: sessions.result.length,
      totalPrice: sessions.result.map((session) => (session.stop) ? session.stop.price : 0).reduce((a, b) => a + b, 0),
      totalConsumptionWh: sessions.result.map((session) => (session.stop) ? session.stop.totalConsumptionWh : 0).reduce((a, b) => a + b, 0)
    };

    res.json({
      users: userStats,
      tags: tagStats,
      emaids: emaidStats,
      chargingStations: chargingStationsStats,
      sessions: sessionsStats
    });
    next();
  }

  

  public static async handleExportStatistics(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    // Check if component is active
    UtilsService.assertComponentIsActiveFromToken(req.user, TenantComponents.STATISTICS,
      Action.READ, Entity.STATISTIC, MODULE_NAME, 'handleExportStatistics');
    // Filter
    const filteredRequest = StatisticsValidatorRest.getInstance().validateStatisticsExport(req.query);
    // Check auth
    const authorizations = await AuthorizationService.checkAndGetStatisticsAuthorizations(req.tenant, req.user, Action.READ, filteredRequest);
    if (!authorizations.authorized) {
      StatisticService.buildAndReturnEmptyStatisticData(res, filteredRequest, next);
      return;
    }
    // Build filter
    const filter = await StatisticService.buildFilter(filteredRequest, req.tenant, req.user, authorizations);
    // Decisions
    let groupBy: string;
    switch (filteredRequest.DataType) {
      case StatsDataType.CONSUMPTION:
        groupBy = StatsGroupBy.CONSUMPTION;
        break;
      case StatsDataType.USAGE:
        groupBy = StatsGroupBy.USAGE;
        break;
      case StatsDataType.INACTIVITY:
        groupBy = StatsGroupBy.INACTIVITY;
        break;
      case StatsDataType.TRANSACTION:
        groupBy = StatsGroupBy.TRANSACTIONS;
        break;
      case StatsDataType.PRICING:
        groupBy = StatsGroupBy.PRICING;
        break;
      default:
        groupBy = StatsGroupBy.CONSUMPTION;
    }
    // Query data
    let transactionStats: ChargingStationStats[] | UserStats[];
    if (filteredRequest.DataCategory === StatsDataCategory.CHARGING_STATION) {
      transactionStats = await StatisticsStorage.getChargingStationStats(req.tenant, filter, groupBy);
    } else {
      transactionStats = await StatisticsStorage.getUserStats(req.tenant, filter, groupBy);
    }
    // Set the attachement name
    res.attachment('exported-' + filteredRequest.DataType.toLowerCase() + '-statistics.csv');
    // Build the result
    const dataToExport = StatisticService.convertToCSV(transactionStats, filteredRequest.DataCategory,
      filteredRequest.DataType, filteredRequest.Year, filteredRequest.DataScope);
    // Send
    res.write(dataToExport);
    // End of stream
    res.end();
  }

  // Only completed transactions
  // eslint-disable-next-line @typescript-eslint/require-await
  public static async buildFilter(filteredRequest: HttpStatisticsGetRequest, tenant: Tenant, userToken: UserToken, authorizations: AuthorizationFilter): Promise<StatisticFilter> {
    // Only completed transactions
    let filter: StatisticFilter = { stop: { $exists: true } };
    // Date
    if ('Year' in filteredRequest) {
      if (filteredRequest.Year > 0) {
        filter.startDateTime = moment().year(filteredRequest.Year).startOf('year').toDate();
        filter.endDateTime = moment().year(filteredRequest.Year).endOf('year').toDate();
      }
    } else {
      // Current year
      filter.startDateTime = moment().startOf('year').toDate();
      filter.endDateTime = moment().endOf('year').toDate();
    }
    // DateFrom
    if (filteredRequest.StartDateTime) {
      filter.startDateTime = filteredRequest.StartDateTime;
    }
    // DateUntil
    if (filteredRequest.EndDateTime) {
      filter.endDateTime = filteredRequest.EndDateTime;
    }
    // Site
    if (filteredRequest.SiteID) {
      filter.siteIDs = filteredRequest.SiteID.split('|');
    }
    // Site Area
    if (filteredRequest.SiteAreaID) {
      filter.siteAreaIDs = filteredRequest.SiteAreaID.split('|');
    }
    // Charge Box
    if (filteredRequest.ChargingStationID) {
      filter.chargeBoxIDs = filteredRequest.ChargingStationID.split('|');
    }
    // DataScope
    if (filteredRequest.DataScope === StatsDataScope.TOTAL || !filteredRequest.DataScope) {
      filter.dataScope = StatsDataScope.MONTH;
    } else {
      filter.dataScope = filteredRequest.DataScope;
    }
    // User
    if (filteredRequest.UserID) {
      filter.userIDs = filteredRequest.UserID.split('|');
    }
    // Override filter with authorizations
    filter = { ...filter, ...authorizations.filters };
    // Remove site filter in case own user search
    if (!filteredRequest.SiteID && filter.userIDs && filter.userIDs.length === 1 && filter.userIDs[0] === userToken.id) {
      filter.siteIDs = [];
    }
    return filter;
  }

  public static convertToGraphData(transactionStats: ChargingStationStats[] | UserStats[], dataCategory: string, dataScope: StatsDataScope = StatsDataScope.MONTH): any[] {
    const transactions: Record<string, number>[] = [];
    // Create
    if (transactionStats && transactionStats.length > 0) {
      // Create
      let period = -1;
      let unit: string;
      let transaction;
      let userName: string;
      for (const transactionStat of transactionStats) {
        const stat = transactionStat[dataScope];
        // Init
        if (transactionStat.unit && (unit !== transactionStat.unit)) {
          // Set
          period = stat;
          unit = transactionStat.unit;
          // Create new
          transaction = {};
          transaction[dataScope] = typeof stat === 'number' ? stat - 1 : stat;
          transaction.unit = transactionStat.unit;
          // Add
          if (transaction) {
            transactions.push(transaction);
          }
        }
        if (period !== stat) {
          // Set
          period = stat;
          // Create new
          transaction = {};
          transaction[dataScope] = typeof stat === 'number' ? stat - 1 : stat;
          if (transactionStat.unit) {
            unit = transactionStat.unit;
            transaction.unit = transactionStat.unit;
          }
          // Add
          if (transaction) {
            transactions.push(transaction);
          }
        }
        // Set key figure (total)
        if (dataCategory === StatsDataCategory.CHARGING_STATION) {
          const chargingStationStats = transactionStat as ChargingStationStats;
          transaction[chargingStationStats.chargeBox] = chargingStationStats.total;
        } else {
          const userStats = transactionStat as UserStats;
          // We can have duplicate user names, like 'Unknown'
          userName = Utils.buildUserFullName(userStats.user, false, false);
          if (userName in transaction) {
            transaction[userName] += userStats.total;
          } else {
            transaction[userName] = userStats.total;
          }
        }
      }
    }
    return transactions;
  }

  public static getPricingCell(transaction: ChargingStationStats | UserStats, numberOfTransactions: number): string[] {
    if (transaction.unit) {
      return [numberOfTransactions.toString(), transaction.unit];
    }
    return [numberOfTransactions.toString(), ' '];
  }

  // Build header row
  public static getYearAndMonthCells(year: number | string, dataScope?: StatsDataScope) : string {
    if (year && year !== '0') {
      const yearHeader = StatsDataScope.YEAR;
      if (dataScope === StatsDataScope.MONTH) {
        return [yearHeader, StatsDataScope.MONTH].join(Constants.CSV_SEPARATOR);
      }
      return yearHeader;
    }
  }

  // Build dataType cells
  public static getDataTypeCells = (dataType: StatsDataType) : string => {
    switch (dataType) {
      case StatsDataType.CONSUMPTION:
        return 'consumption';
      case StatsDataType.USAGE:
        return 'usage';
      case StatsDataType.INACTIVITY:
        return 'inactivity';
      case StatsDataType.TRANSACTION:
        return 'numberOfSessions';
      case StatsDataType.PRICING:
        return ['price', 'priceUnit'].join(Constants.CSV_SEPARATOR);
      default:
        return '';
    }
  };

  public static convertToCSV(transactionStats: ChargingStationStats[] | UserStats[],
      dataCategory: StatsDataCategory, dataType: StatsDataType, year: number | string, dataScope?: StatsDataScope): string {
    const headers = [
      dataCategory === StatsDataCategory.CHARGING_STATION ? 'chargingStation' : 'user',
      StatisticService.getYearAndMonthCells(year, dataScope),
      StatisticService.getDataTypeCells(dataType)
    ];
    let index: number;
    const transactions = [];
    if (transactionStats && transactionStats.length > 0) {
      for (const transactionStat of transactionStats) {
        if (!year || year === '0' || !dataScope || (dataScope && dataScope !== StatsDataScope.MONTH)) {
          // Annual or overall values
          transactionStat.month = 0;
          index = -1;
          if (transactions && transactions.length > 0) {
            if (dataCategory === StatsDataCategory.CHARGING_STATION) {
              const chargingStationStats = transactionStat as ChargingStationStats;
              index = transactions.findIndex((record) => {
                if (!record.unit || !transactionStat.unit) {
                  return (record.chargeBox === chargingStationStats.chargeBox);
                }
                return ((record.chargeBox === chargingStationStats.chargeBox)
                  && (record.unit === chargingStationStats.unit));
              });
            } else {
              const userStats = transactionStat as UserStats;
              index = transactions.findIndex((record) => {
                if (!record.unit || !userStats.unit) {
                  return ((record.user.name === userStats.user.name)
                    && (record.user.firstName === userStats.user.firstName));
                }
                return ((record.user.name === userStats.user.name)
                  && (record.user.firstName === userStats.user.firstName)
                  && (record.unit === userStats.unit));
              });
            }
          }
          if (index < 0) {
            transactions.push(transactionStat);
          } else {
            transactions[index].total += transactionStat.total;
          }
        } else if (dataCategory === StatsDataCategory.CHARGING_STATION) {
          const chargingStationStats = transactionStat as ChargingStationStats;
          transactions.push(chargingStationStats);
        } else {
          const userStats = transactionStat as UserStats;
          // Treat duplicate names (like 'Unknown')
          index = transactions.findIndex((record) => {
            if (!record.unit || !userStats.unit) {
              return ((record.month === userStats.month)
                && (record.user.name === userStats.user.name)
                && (record.user.firstName === userStats.user.firstName));
            }
            return ((record.month === userStats.month)
              && (record.user.name === userStats.user.name)
              && (record.user.firstName === userStats.user.firstName)
              && (record.unit === userStats.unit));
          });
          if (index < 0) {
            transactions.push(userStats);
          } else {
            transactions[index].total += userStats.total;
          }
        }
      }
      if (dataCategory === StatsDataCategory.CHARGING_STATION) {
        // Sort by Charging Station and month
        transactions.sort((rec1, rec2) => {
          if (rec1.chargeBox > rec2.chargeBox) {
            return 1;
          }
          if (rec1.chargeBox < rec2.chargeBox) {
            return -1;
          }
          // Charging Station is the same, now compare month
          if (rec1.month > rec2.month) {
            return 1;
          }
          if (rec1.month < rec2.month) {
            return -1;
          }
          if (rec1.unit && rec2.unit) {
            if (rec1.unit > rec2.unit) {
              return 1;
            }
            if (rec1.unit < rec2.unit) {
              return -1;
            }
          }
          return 0;
        });
      } else {
        // Sort by user name and month
        transactions.sort((rec1, rec2) => {
          if (rec1.user.name > rec2.user.name) {
            return 1;
          }
          if (rec1.user.name < rec2.user.name) {
            return -1;
          }
          if (rec1.user.firstName > rec2.user.firstName) {
            return 1;
          }
          if (rec1.user.firstName < rec2.user.firstName) {
            return -1;
          }
          // Name and first name are identical, now compare month
          if (rec1.month > rec2.month) {
            return 1;
          }
          if (rec1.month < rec2.month) {
            return -1;
          }
          if (rec1.unit && rec2.unit) {
            if (rec1.unit > rec2.unit) {
              return 1;
            }
            if (rec1.unit < rec2.unit) {
              return -1;
            }
          }
          return 0;
        });
      }
      // Now build the export file
      let numberOfTransactions: number;
      const rows = transactions.map((transaction) => {
        numberOfTransactions = Utils.truncTo(transaction.total, 2);
        // Use raw numbers - it makes no sense to format numbers here,
        // anyway only locale 'en-US' is supported here as could be seen by:
        // const supportedLocales = Intl.NumberFormat.supportedLocalesOf(['fr-FR', 'en-US', 'de-DE']);
        const row = [
          dataCategory === StatsDataCategory.CHARGING_STATION ? transaction.chargeBox : Utils.buildUserFullName(transaction.user, false),
          year && year !== '0' ? year : '',
          transaction.month > 0 ? transaction.month : '',
          dataType === StatsDataType.PRICING ? StatisticService.getPricingCell(transaction, numberOfTransactions) : numberOfTransactions.toString()
        ].map((value) => Utils.escapeCsvValue(value));
        return row;
      }).join(Constants.CR_LF);
      return [headers, rows].join(Constants.CR_LF);
    }
  }

  // Function that allows retrocompatibility: would either return raw statistic values or convert it into a datasource with auth flags
  private static async buildAndReturnStatisticData(req: Request, res: Response, data: any, filteredRequest: HttpStatisticsGetRequest, authorizations: AuthorizationFilter, next: NextFunction) {
    // Check return type and add auth
    if (filteredRequest.WithAuth) {
      const transactionsDataResult: StatisticDataResult = {
        result: data,
        count: data.length
      };
      // Add auth
      await AuthorizationService.addStatisticsAuthorizations(req.tenant, req.user, transactionsDataResult, authorizations);
      res.json(transactionsDataResult);
      next();
    } else {
      res.json(data);
      next();
    }
  }

  private static buildAndReturnEmptyStatisticData(res: Response, filteredRequest: HttpStatisticsGetRequest, next: NextFunction) {
    // Empty data result
    if (filteredRequest.WithAuth) {
      UtilsService.sendEmptyDataResult(res, next);
      return;
    }
    // Empty array
    UtilsService.sendEmptyArray(res, next);
    // eslint-disable-next-line no-useless-return
    return;
  }
}
