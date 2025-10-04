/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { ChargePointStatus, OCPPFirmwareStatus } from '../../types/ocpp/OCPPServer';
import { ChargingProfile, ChargingProfilePurposeType, ChargingRateUnitType } from '../../types/ChargingProfile';
import { ChargingProfileDataResult, ChargingStationDataResult, ChargingStationInErrorDataResult, DataResult } from '../../types/DataResult';
import ChargingStation, { ChargePoint, ChargingStationOcpiData, ChargingStationOcppParameters, ChargingStationOicpData, ChargingStationTemplate, Connector, ConnectorType, CurrentType, OcppParameter, PhaseAssignmentToGrid, RemoteAuthorization, Voltage } from '../../types/ChargingStation';
import { GridFSBucket, GridFSBucketReadStream, GridFSBucketWriteStream, ObjectId, UpdateResult } from 'mongodb';
import Tenant, { TenantComponents } from '../../types/Tenant';
import global, { DatabaseCount, FilterParams } from '../../types/GlobalType';
import BackendError from '../../exception/BackendError';
import { ChargingStationInErrorType } from '../../types/InError';
import ChargingStationValidatorStorage from '../validator/ChargingStationValidatorStorage';
import Configuration from '../../utils/Configuration';
import Constants from '../../utils/Constants';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import { InactivityStatus } from '../../types/Transaction';
import Logging from '../../utils/Logging';
import TenantStorage from '../../storage/mongodb/TenantStorage';
import Utils from '../../utils/Utils';
import moment from 'moment';
import { ServerAction } from '../../types/Server';

const MODULE_NAME = 'ChargingStationStorage';

export interface ConnectorMDB {
  id?: string; // Needed for the roaming component
  connectorId: number;
  currentInstantWatts: number;
  currentStateOfCharge: number;
  currentTotalConsumptionWh: number;
  currentTotalInactivitySecs: number;
  currentInactivityStatus: InactivityStatus;
  currentTransactionID: number;
  currentTransactionDate: Date;
  currentTagID: string;
  status: ChargePointStatus;
  errorCode: string;
  info: string;
  vendorErrorCode: string;
  power: number;
  type: ConnectorType;
  voltage: Voltage;
  amperage: number;
  amperageLimit: number;
  currentUserID: ObjectId;
  statusLastChangedOn: Date;
  numberOfConnectedPhase: number;
  currentType: CurrentType;
  chargePointID: number;
  phaseAssignmentToGrid: PhaseAssignmentToGrid;
  tariffID?: string;
  tariffIDs?: string[];
  isPrivate?: boolean;
  ownerIds?: string[];
  certificateIDs?: string[]; // Ajouté pour associer des certificats aux connecteurs
}

export default class ChargingStationStorage {

  public static async getChargingStationTemplates(chargePointVendor?: string): Promise<ChargingStationTemplate[]> {
    const startTime = Logging.traceDatabaseRequestStart();
    const aggregation = [];
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    const chargingStationTemplatesMDB = await global.database.getCollection<any>(Constants.DEFAULT_TENANT_ID, 'chargingstationtemplates')
      .aggregate<any>(aggregation)
      .toArray() as ChargingStationTemplate[];
    const chargingStationTemplates: ChargingStationTemplate[] = [];
    for (const chargingStationTemplateMDB of chargingStationTemplatesMDB) {
      const regExp = new RegExp(chargingStationTemplateMDB.template.chargePointVendor);
      if (regExp.test(chargePointVendor)) {
        chargingStationTemplates.push(chargingStationTemplateMDB);
      }
    }
    await Logging.traceDatabaseRequestEnd(Constants.DEFAULT_TENANT_OBJECT, MODULE_NAME, 'getChargingStationTemplates', startTime, aggregation, chargingStationTemplatesMDB);
    return chargingStationTemplates;
  }

  public static async deleteChargingStationTemplates(): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    await global.database.getCollection<any>(Constants.DEFAULT_TENANT_ID, 'chargingstationtemplates').deleteMany(
      { qa: { $not: { $eq: true } } }
    );
    await Logging.traceDatabaseRequestEnd(Constants.DEFAULT_TENANT_OBJECT, MODULE_NAME, 'deleteChargingStationTemplates', startTime, { qa: { $not: { $eq: true } } });
  }

  public static async getChargingStation(tenant: Tenant, id: string = Constants.UNKNOWN_STRING_ID,
      params: { includeDeleted?: boolean; issuer?: boolean; siteIDs?: string[]; withSiteArea?: boolean; withSite?: boolean; withCertificates?: boolean } = {},
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      chargingStationIDs: [id],
      withCertificates: params.withCertificates,
      withSite: params.withSite,
      withSiteArea: params.withSiteArea,
      includeDeleted: params.includeDeleted,
      issuer: params.issuer,
      siteIDs: params.siteIDs,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingProfile(tenant: Tenant, id: string = Constants.UNKNOWN_STRING_ID,
      params: { siteIDs?: string[]; withSiteArea?: boolean; } = {},
      projectFields?: string[]): Promise<ChargingProfile> {
    const chargingProfilesMDB = await ChargingStationStorage.getChargingProfiles(tenant, {
      chargingProfileID: id,
      siteIDs: params.siteIDs,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingProfilesMDB.count === 1 ? chargingProfilesMDB.result[0] : null;
  }

  public static async getChargingStationByOcpiLocationEvseUid(tenant: Tenant, ocpiLocationID: string = Constants.UNKNOWN_STRING_ID,
      ocpiEvseUid: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      ocpiLocationID,
      ocpiEvseUid,
      withSite: true,
      withSiteArea: true,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getStationTenantByEvseId(tenant: Tenant, ocpiLocationID: string = Constants.UNKNOWN_STRING_ID,
      ocpiEvseUid: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]) {
    let tenants = [tenant];
    if (tenant.type === 'Parent') {
      const children = await TenantStorage.getTenants({ tenantParentID: tenant.id }, Constants.DB_PARAMS_MAX_LIMIT);
      tenants = [...tenants, ...children.result];
    }
    let childTenant;
    for (const tenant of tenants) {
      const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
        ocpiLocationID,
        ocpiEvseUid,
        withSite: true,
        withSiteArea: true,
      }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
      if (chargingStationsMDB.count === 1) {
        childTenant = tenant;
      }
    }
    return childTenant;
  }

  public static async getChargingStationByOicpEvseID(tenant: Tenant, oicpEvseID: string = Constants.UNKNOWN_STRING_ID,
      projectFields?: string[]): Promise<ChargingStation> {
    const chargingStationsMDB = await ChargingStationStorage.getChargingStations(tenant, {
      oicpEvseID: oicpEvseID,
      withSiteArea: true
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return chargingStationsMDB.count === 1 ? chargingStationsMDB.result[0] : null;
  }

  public static async getChargingStations(tenant: Tenant,
      params: {
        search?: string; chargingStationIDs?: string[]; chargingStationSerialNumbers?: string[]; siteAreaIDs?: string[]; withNoSiteArea?: boolean;
        connectorStatuses?: ChargePointStatus[]; connectorTypes?: ConnectorType[]; statusChangedBefore?: Date; withSiteArea?: boolean; withUser?: boolean;
        ocpiEvseUid?: string; ocpiLocationID?: string; oicpEvseID?: string;
        siteIDs?: string[]; companyIDs?: string[]; withSite?: boolean; includeDeleted?: boolean; offlineSince?: Date; issuer?: boolean;
        locCoordinates?: number[]; locMaxDistanceMeters?: number; public?: boolean; withCertificates?: boolean;
      },
      dbParams: DbParams, projectFields?: string[]): Promise<ChargingStationDataResult> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    dbParams = Utils.cloneObject(dbParams);
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    const aggregation = [];
    if (Utils.hasValidGpsCoordinates(params.locCoordinates)) {
      aggregation.push({
        $geoNear: {
          near: { type: 'Point', coordinates: params.locCoordinates },
          distanceField: 'distanceMeters',
          maxDistance: params.locMaxDistanceMeters > 0 ? params.locMaxDistanceMeters : Constants.MAX_GPS_DISTANCE_METERS,
          spherical: true
        }
      });
    }
    const filters: FilterParams = {};
    if (params.search) {
      filters.$or = [
        { _id: { $regex: params.search, $options: 'im' } },
        { _id: params.search },
        { 'ocpiData.evses.uid': { $regex: params.search, $options: 'im' } },
        { 'ocpiData.evses.location_id': { $regex: params.search, $options: 'im' } },
        { chargePointModel: { $regex: params.search, $options: 'im' } },
        { chargePointVendor: { $regex: params.search, $options: 'im' } }
      ];
    }
    if (!params.includeDeleted) {
      filters.deleted = { '$ne': true };
    }
    if (Utils.objectHasProperty(params, 'public')) {
      filters.public = params.public;
    }
    if (!Utils.isEmptyArray(params.chargingStationIDs)) {
      filters._id = { $in: params.chargingStationIDs };
    }
    if (!Utils.isEmptyArray(params.chargingStationSerialNumbers)) {
      filters.chargeBoxSerialNumber = { $in: params.chargingStationSerialNumbers };
    }
    if (params.ocpiEvseUid) {
      filters['ocpiData.evses.uid'] = params.ocpiEvseUid;
    }
    if (params.ocpiLocationID) {
      filters['ocpiData.evses.location_id'] = params.ocpiLocationID;
    }
    if (params.oicpEvseID) {
      filters['oicpData.evses.EvseID'] = params.oicpEvseID;
    }
    if (params.offlineSince && moment(params.offlineSince).isValid()) {
      filters.lastSeen = { $lte: params.offlineSince };
    }
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    DatabaseUtils.pushChargingStationInactiveFlagInAggregation(aggregation);
    aggregation.push({ $match: filters });
    if (!Utils.isEmptyArray(params.connectorStatuses)) {
      DatabaseUtils.pushArrayFilterInAggregation(aggregation, 'connectors',
        { 'connectors.status': { $in: params.connectorStatuses } });
    }
    if (!Utils.isEmptyArray(params.connectorTypes)) {
      DatabaseUtils.pushArrayFilterInAggregation(aggregation, 'connectors',
        { 'connectors.type': { $in: params.connectorTypes } });
    }
    if (params.withNoSiteArea) {
      filters.siteAreaID = null;
    } else if (!Utils.isEmptyArray(params.siteAreaIDs)) {
      filters.siteAreaID = { $in: params.siteAreaIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    if (!Utils.isEmptyArray(params.siteIDs)) {
      filters.siteID = { $in: params.siteIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    if (!Utils.isEmptyArray(params.companyIDs)) {
      filters.companyID = { $in: params.companyIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    if (params.statusChangedBefore && moment(params.statusChangedBefore).isValid()) {
      aggregation.push({
        $match: { 'connectors.statusLastChangedOn': { $lte: params.statusChangedBefore } }
      });
    }
    if (!dbParams.onlyRecordCount) {
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    const chargingStationsCountMDB = await global.database.getCollection<any>(tenant.id, 'chargingstations')
      .aggregate([...aggregation, { $count: 'count' }])
      .toArray() as DatabaseCount[];
    if (dbParams.onlyRecordCount) {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getChargingStations', startTime, aggregation, chargingStationsCountMDB);
      return {
        count: (chargingStationsCountMDB.length > 0 ? chargingStationsCountMDB[0].count : 0),
        result: []
      };
    }
    aggregation.pop();
    if (!dbParams.sort) {
      dbParams.sort = { _id: 1 };
    }
    if (Utils.hasValidGpsCoordinates(params.locCoordinates)) {
      dbParams.sort = { distanceMeters: 1 };
    }
    aggregation.push({ $sort: dbParams.sort });
    aggregation.push({ $skip: dbParams.skip });
    aggregation.push({ $limit: dbParams.limit });
    if (params.withUser) {
      DatabaseUtils.pushArrayLookupInAggregation('connectors', DatabaseUtils.pushUserLookupInAggregation.bind(this), {
        tenantID: tenant.id, aggregation: aggregation, localField: 'connectors.currentUserID', foreignField: '_id',
        asField: 'connectors.user', oneToOneCardinality: true, objectIDFields: ['createdBy', 'lastChangedBy']
      }, { sort: dbParams.sort });
    }
    if (params.withSiteArea) {
      DatabaseUtils.pushSiteAreaLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: 'siteAreaID', foreignField: '_id',
        asField: 'siteArea', oneToOneCardinality: true
      });
    }
    if (params.withSite) {
      DatabaseUtils.pushSiteLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: 'siteID', foreignField: '_id',
        asField: 'site', oneToOneCardinality: true
      });
    }
    if (params.withCertificates) {
      DatabaseUtils.pushArrayLookupInAggregation('connectors', null, {
        tenantID: tenant.id, aggregation: aggregation, localField: 'connectors.certificateIDs', foreignField: '_id',
        asField: 'connectors.certificates', oneToOneCardinality: false,
      }, {});
    }
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteArea.siteID');
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'companyID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'siteAreaID');
    DatabaseUtils.projectFields(aggregation, projectFields);
    if (!Utils.hasValidGpsCoordinates(params.locCoordinates)) {
      aggregation.push({ $sort: dbParams.sort });
    }
    const chargingStationsMDB = await global.database.getCollection<any>(tenant.id, 'chargingstations')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as ChargingStation[];
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getChargingStations', startTime, aggregation, chargingStationsMDB);
    return {
      count: DatabaseUtils.getCountFromDatabaseCount(chargingStationsCountMDB[0]),
      result: chargingStationsMDB
    };
  }

  public static async getChargingStationsInError(tenant: Tenant,
      params: { search?: string; siteIDs?: string[]; siteAreaIDs: string[]; errorType?: string[] },
      dbParams: DbParams, projectFields?: string[]): Promise<ChargingStationInErrorDataResult> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    dbParams = Utils.cloneObject(dbParams);
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    const aggregation = [];
    DatabaseUtils.pushChargingStationInactiveFlagInAggregation(aggregation);
    const filters: FilterParams = {};
    if (params.search) {
      filters.$or = [
        { _id: { $regex: params.search, $options: 'im' } },
        { chargePointModel: { $regex: params.search, $options: 'im' } },
        { chargePointVendor: { $regex: params.search, $options: 'im' } }
      ];
    }
    filters.deleted = { '$ne': true };
    filters.issuer = true;
    if (!Utils.isEmptyArray(params.siteAreaIDs)) {
      filters.siteAreaID = { $in: params.siteAreaIDs.map((id) => DatabaseUtils.convertToObjectID(id)) };
    }
    aggregation.push({ $match: filters });
    aggregation.push({
      $lookup: {
        from: DatabaseUtils.getCollectionName(tenant.id, 'siteareas'),
        localField: 'siteAreaID',
        foreignField: '_id',
        as: 'sitearea'
      }
    });
    aggregation.push({ $unwind: { 'path': '$sitearea', 'preserveNullAndEmptyArrays': true } });
    if (!Utils.isEmptyArray(params.siteIDs)) {
      aggregation.push({
        $match: {
          'sitearea.siteID': { $in: params.siteIDs.map((id) => DatabaseUtils.convertToObjectID(id)) }
        }
      });
    }
    const facets: any = { $facet: {} };
    if (!Utils.isEmptyArray(params.errorType)) {
      if (!Utils.isTenantComponentActive(tenant, TenantComponents.ORGANIZATION) && params.errorType.includes(ChargingStationInErrorType.MISSING_SITE_AREA)) {
        throw new BackendError({
          module: MODULE_NAME,
          method: 'getChargingStationsInError',
          message: 'Organization is not active whereas filter is on missing site.'
        });
      }
      const array = [];
      for (const type of params.errorType) {
        array.push(`$${type}`);
        facets.$facet[type] = ChargingStationStorage.getChargerInErrorFacet(type);
      }
      aggregation.push(facets);
      aggregation.push({ $project: { chargersInError: { $setUnion: array } } });
      aggregation.push({ $unwind: '$chargersInError' });
      aggregation.push({ $replaceRoot: { newRoot: '$chargersInError' } });
      aggregation.push({ $addFields: { 'uniqueId': { $concat: ['$_id', '#', '$errorCode'] } } });
    }
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    if (!dbParams.sort) {
      dbParams.sort = { _id: 1 };
    }
    aggregation.push({ $sort: dbParams.sort });
    aggregation.push({ $skip: dbParams.skip });
    aggregation.push({ $limit: dbParams.limit });
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    DatabaseUtils.projectFields(aggregation, projectFields);
    const chargingStationsMDB = await global.database.getCollection<any>(tenant.id, 'chargingstations')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as ChargingStation[];
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getChargingStationsInError', startTime, aggregation, chargingStationsMDB);
    return {
      count: chargingStationsMDB.length,
      result: chargingStationsMDB
    };
  }

  public static async saveChargingStation(tenant: Tenant, chargingStationToSave: ChargingStation): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    delete chargingStationToSave['registrationStatus'];
    const chargingStationMDB = {
      _id: chargingStationToSave.id,
      templateHash: chargingStationToSave.templateHash,
      templateHashTechnical: chargingStationToSave.templateHashTechnical,
      templateHashCapabilities: chargingStationToSave.templateHashCapabilities,
      templateHashOcppStandard: chargingStationToSave.templateHashOcppStandard,
      templateHashOcppVendor: chargingStationToSave.templateHashOcppVendor,
      issuer: Utils.convertToBoolean(chargingStationToSave.issuer),
      public: Utils.convertToBoolean(chargingStationToSave.public),
      companyID: DatabaseUtils.convertToObjectID(chargingStationToSave.companyID),
      siteID: DatabaseUtils.convertToObjectID(chargingStationToSave.siteID),
      siteAreaID: DatabaseUtils.convertToObjectID(chargingStationToSave.siteAreaID),
      chargePointSerialNumber: chargingStationToSave.chargePointSerialNumber,
      chargePointModel: chargingStationToSave.chargePointModel,
      chargeBoxSerialNumber: chargingStationToSave.chargeBoxSerialNumber,
      chargePointVendor: chargingStationToSave.chargePointVendor,
      iccid: chargingStationToSave.iccid,
      imsi: chargingStationToSave.imsi,
      tokenID: chargingStationToSave.tokenID,
      meterType: chargingStationToSave.meterType,
      firmwareVersion: chargingStationToSave.firmwareVersion,
      meterSerialNumber: chargingStationToSave.meterSerialNumber,
      endpoint: chargingStationToSave.endpoint,
      ocppVersion: chargingStationToSave.ocppVersion,
      cloudHostIP: chargingStationToSave.cloudHostIP,
      cloudHostName: chargingStationToSave.cloudHostName,
      ocppProtocol: chargingStationToSave.ocppProtocol,
      lastSeen: Utils.convertToDate(chargingStationToSave.lastSeen),
      deleted: Utils.convertToBoolean(chargingStationToSave.deleted),
      lastReboot: Utils.convertToDate(chargingStationToSave.lastReboot),
      chargingStationURL: chargingStationToSave.chargingStationURL,
      maximumPower: Utils.convertToInt(chargingStationToSave.maximumPower),
      masterSlave: Utils.convertToBoolean(chargingStationToSave.masterSlave),
      excludeFromSmartCharging: Utils.convertToBoolean(chargingStationToSave.excludeFromSmartCharging),
      forceInactive: Utils.convertToBoolean(chargingStationToSave.forceInactive),
      manualConfiguration: Utils.convertToBoolean(chargingStationToSave.manualConfiguration),
      powerLimitUnit: chargingStationToSave.powerLimitUnit,
      voltage: Utils.convertToInt(chargingStationToSave.voltage),
      connectors: chargingStationToSave.connectors ? chargingStationToSave.connectors.map(
        (connector) => ChargingStationStorage.filterConnectorMDB(connector)) : [],
      backupConnectors: chargingStationToSave.backupConnectors ? chargingStationToSave.backupConnectors.map(
        (backupConnector) => ChargingStationStorage.filterConnectorMDB(backupConnector)) : [],
      chargePoints: chargingStationToSave.chargePoints ? chargingStationToSave.chargePoints.map(
        (chargePoint) => ChargingStationStorage.filterChargePointMDB(chargePoint)) : [],
      coordinates: Utils.hasValidGpsCoordinates(chargingStationToSave.coordinates) ? chargingStationToSave.coordinates.map(
        (coordinate) => Utils.convertToFloat(coordinate)) : [],
      currentIPAddress: chargingStationToSave.currentIPAddress,
      capabilities: chargingStationToSave.capabilities,
      ocppStandardParameters: chargingStationToSave.ocppStandardParameters,
      ocppVendorParameters: chargingStationToSave.ocppVendorParameters,
      tariffID: chargingStationToSave.tariffID,
      tariffIDs: chargingStationToSave.tariffIDs,
      certificateIDs: chargingStationToSave.certificateIDs || [] // Ajout des certificateIDs au niveau de la borne
    };
    DatabaseUtils.addLastChangedCreatedProps(chargingStationMDB, chargingStationToSave);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { _id: chargingStationToSave.id },
      { $set: chargingStationMDB },
      { upsert: true });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStation', startTime, chargingStationMDB);
    return chargingStationMDB._id;
  }

  public static async saveChargingStationConnectors(tenant: Tenant, id: string, connectors: Connector[], backupConnectors?: Connector[]): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const updatedProps: any = {};
    updatedProps.connectors = connectors.map((connector) =>
      ChargingStationStorage.filterConnectorMDB(connector));
    if (backupConnectors) {
      updatedProps.backupConnectors = backupConnectors.map((backupConnector) =>
        ChargingStationStorage.filterConnectorMDB(backupConnector));
    }
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: updatedProps },
      { upsert: true });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationConnectors', startTime, connectors);
  }

  public static async saveChargingStationOicpData(tenant: Tenant, id: string, oicpData: ChargingStationOicpData): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: { oicpData } },
      { upsert: false });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationOicpData', startTime, oicpData);
  }

  public static async saveChargingStationRuntimeData(tenant: Tenant, id: string,
      runtimeData: { lastSeen?: Date; currentIPAddress?: string | string[]; tokenID?: string; cloudHostIP?: string; cloudHostName?: string; }): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const runtimeDataMDB: { lastSeen?: Date; currentIPAddress?: string | string[]; tokenID?: string; cloudHostIP?: string; cloudHostName?: string; } = {};
    if (runtimeData.lastSeen) {
      runtimeDataMDB.lastSeen = Utils.convertToDate(runtimeData.lastSeen);
    }
    if (runtimeData.currentIPAddress) {
      runtimeDataMDB.currentIPAddress = runtimeData.currentIPAddress;
    }
    if (runtimeData.tokenID) {
      runtimeDataMDB.tokenID = runtimeData.tokenID;
    }
    if (runtimeData.cloudHostIP || runtimeData.cloudHostName) {
      runtimeDataMDB.cloudHostIP = runtimeData.cloudHostIP;
      runtimeDataMDB.cloudHostName = runtimeData.cloudHostName;
    }
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: runtimeDataMDB },
      { upsert: true });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationRuntimeData', startTime, runtimeData);
  }

  public static async saveChargingStationOcpiData(tenant: Tenant, id: string, ocpiData: ChargingStationOcpiData): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: { ocpiData } },
      { upsert: false });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationOcpiData', startTime, ocpiData);
  }

  public static async saveChargingStationRemoteAuthorizations(tenant: Tenant, id: string, remoteAuthorizations: RemoteAuthorization[]): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: { remoteAuthorizations } },
      { upsert: false });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationRemoteAuthorizations', startTime, remoteAuthorizations);
  }

  public static async saveChargingStationFirmwareStatus(tenant: Tenant, id: string, firmwareUpdateStatus: OCPPFirmwareStatus): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndUpdate(
      { '_id': id },
      { $set: { firmwareUpdateStatus } },
      { upsert: true });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingStationFirmwareStatus', startTime, firmwareUpdateStatus);
  }

  public static async deleteChargingStation(tenant: Tenant, id: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'configurations').findOneAndDelete({ '_id': id });
    await ChargingStationStorage.deleteChargingProfiles(tenant, id);
    await global.database.getCollection<any>(tenant.id, 'chargingstations').findOneAndDelete({ '_id': id });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteChargingStation', startTime, { id });
  }

  public static async associateCertificateToChargingStation(tenant: Tenant, chargingStationID: string, certificateID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const certificateExists = await global.database.getCollection<any>(tenant.id, 'certificates').findOne({ _id: certificateID });
      if (!certificateExists) {
        throw new Error(`Certificate with ID ${certificateID} not found`);
      }

      await global.database.getCollection<any>(tenant.id, 'chargingstations').updateOne(
        { _id: chargingStationID },
        { $addToSet: { certificateIDs: certificateID } }
      );

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'associateCertificateToChargingStation',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Certificate ${certificateID} associated with charging station ${chargingStationID}`,
        detailedMessages: { chargingStationID, certificateID }
      });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'associateCertificateToChargingStation',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to associate certificate to charging station',
        detailedMessages: { error: error.stack, chargingStationID, certificateID }
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'associateCertificateToChargingStation', startTime, { chargingStationID, certificateID });
    }
  }

  public static async dissociateCertificateFromChargingStation(tenant: Tenant, chargingStationID: string, certificateID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      await global.database.getCollection<any>(tenant.id, 'chargingstations').updateOne(
        { _id: chargingStationID },
        { $pull: { certificateIDs: certificateID } }
      );

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'dissociateCertificateFromChargingStation',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Certificate ${certificateID} dissociated from charging station ${chargingStationID}`,
        detailedMessages: { chargingStationID, certificateID }
      });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'dissociateCertificateFromChargingStation',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to dissociate certificate from charging station',
        detailedMessages: { error: error.stack, chargingStationID, certificateID }
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'dissociateCertificateFromChargingStation', startTime, { chargingStationID, certificateID });
    }
  }

  public static async associateCertificateToConnector(tenant: Tenant, chargingStationID: string, connectorId: number, certificateID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      const certificateExists = await global.database.getCollection<any>(tenant.id, 'certificates').findOne({ _id: certificateID });
      if (!certificateExists) {
        throw new Error(`Certificate with ID ${certificateID} not found`);
      }

      await global.database.getCollection<any>(tenant.id, 'chargingstations').updateOne(
        { _id: chargingStationID, 'connectors.connectorId': connectorId },
        { $addToSet: { 'connectors.$.certificateIDs': certificateID } }
      );

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'associateCertificateToConnector',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Certificate ${certificateID} associated with connector ${connectorId} of charging station ${chargingStationID}`,
        detailedMessages: { chargingStationID, connectorId, certificateID }
      });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'associateCertificateToConnector',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to associate certificate to connector',
        detailedMessages: { error: error.stack, chargingStationID, connectorId, certificateID }
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'associateCertificateToConnector', startTime, { chargingStationID, connectorId, certificateID });
    }
  }

  public static async dissociateCertificateFromConnector(tenant: Tenant, chargingStationID: string, connectorId: number, certificateID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);

    try {
      await global.database.getCollection<any>(tenant.id, 'chargingstations').updateOne(
        { _id: chargingStationID, 'connectors.connectorId': connectorId },
        { $pull: { 'connectors.$.certificateIDs': certificateID } }
      );

      await Logging.logInfo({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'dissociateCertificateFromConnector',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: `Certificate ${certificateID} dissociated from connector ${connectorId} of charging station ${chargingStationID}`,
        detailedMessages: { chargingStationID, connectorId, certificateID }
      });
    } catch (error) {
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME,
        method: 'dissociateCertificateFromConnector',
        action: ServerAction.CHARGING_STATION_DATA_TRANSFER,
        message: 'Failed to dissociate certificate from connector',
        detailedMessages: { error: error.stack, chargingStationID, connectorId, certificateID }
      });
      throw error;
    } finally {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'dissociateCertificateFromConnector', startTime, { chargingStationID, connectorId, certificateID });
    }
  }

  public static async getOcppParameterValue(tenant: Tenant, chargeBoxID: string, paramName: string): Promise<string> {
    const configuration = await ChargingStationStorage.getOcppParameters(tenant, chargeBoxID);
    let value: string = null;
    if (configuration) {
      configuration.result.every((param) => {
        if (param.key === paramName) {
          value = param.value;
          return false;
        }
        return true;
      });
    }
    return value;
  }

  public static async saveOcppParameters(tenant: Tenant, parameters: ChargingStationOcppParameters): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'configurations').findOneAndUpdate({
      '_id': parameters.id
    }, {
      $set: {
        configuration: parameters.configuration,
        timestamp: Utils.convertToDate(parameters.timestamp)
      }
    }, {
      upsert: true,
      returnDocument: 'after'
    });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveOcppParameters', startTime, parameters);
  }

  public static async getOcppParameters(tenant: Tenant, id: string): Promise<DataResult<OcppParameter>> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const parametersMDB = await global.database.getCollection<any>(tenant.id, 'configurations')
      .findOne({ '_id': id }) as ChargingStationOcppParameters;
    if (parametersMDB) {
      if (parametersMDB.configuration) {
        parametersMDB.configuration.sort((param1, param2) => {
          if (param1.key.toLocaleLowerCase() < param2.key.toLocaleLowerCase()) {
            return -1;
          }
          if (param1.key.toLocaleLowerCase() > param2.key.toLocaleLowerCase()) {
            return 1;
          }
          return 0;
        });
      }
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getOcppParameters', startTime, { id }, parametersMDB);
      return {
        count: parametersMDB.configuration.length,
        result: parametersMDB.configuration
      };
    }
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getOcppParameters', startTime, { id }, parametersMDB);
    return {
      count: 0,
      result: []
    };
  }

  public static async getChargingProfiles(tenant: Tenant,
      params: { search?: string; chargingStationIDs?: string[]; connectorID?: number; chargingProfileID?: string;
        profilePurposeType?: ChargingProfilePurposeType; transactionId?: number;
        withSiteArea?: boolean; siteIDs?: string[]; } = {},
      dbParams: DbParams, projectFields?: string[]): Promise<ChargingProfileDataResult> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    dbParams = Utils.cloneObject(dbParams);
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    const filters: FilterParams = {};
    if (params.search) {
      filters.$or = [
        { 'chargingStationID': { $regex: params.search, $options: 'i' } },
        { 'profile.transactionId': Utils.convertToInt(params.search) },
      ];
    }
    if (params.chargingProfileID) {
      filters._id = params.chargingProfileID;
    } else {
      if (params.chargingStationIDs) {
        filters.chargingStationID = { $in: params.chargingStationIDs };
      }
      if (params.connectorID) {
        filters.connectorID = params.connectorID;
      }
      if (params.profilePurposeType) {
        filters['profile.chargingProfilePurpose'] = params.profilePurposeType;
      }
      if (params.transactionId) {
        filters['profile.transactionId'] = params.transactionId;
      }
    }
    const aggregation = [];
    if (filters) {
      aggregation.push({ $match: filters });
    }
    DatabaseUtils.pushChargingStationLookupInAggregation({
      tenantID: tenant.id, aggregation, localField: 'chargingStationID', foreignField: '_id',
      asField: 'chargingStation', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
    });
    if (params.withSiteArea) {
      DatabaseUtils.pushSiteAreaLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'chargingStation.siteAreaID', foreignField: '_id',
        asField: 'chargingStation.siteArea', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
      DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteArea.siteID');
    }
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteAreaID');
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'chargingStation.siteID');
    if (!Utils.isEmptyArray(params.siteIDs)) {
      aggregation.push({
        $match: { 'chargingStation.siteID': { $in: params.siteIDs } }
      });
    }
    if (!dbParams.onlyRecordCount) {
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    const chargingProfilesCountMDB = await global.database.getCollection<any>(tenant.id, 'chargingprofiles')
      .aggregate([...aggregation, { $count: 'count' }], DatabaseUtils.buildAggregateOptions())
      .toArray() as DatabaseCount[];
    if (dbParams.onlyRecordCount) {
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getChargingProfiles', startTime, aggregation, chargingProfilesCountMDB);
      return {
        count: (chargingProfilesCountMDB.length > 0 ? chargingProfilesCountMDB[0].count : 0),
        result: []
      };
    }
    aggregation.pop();
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    if (!dbParams.sort) {
      dbParams.sort = {
        'chargingStationID': 1,
        'connectorID': 1,
        'profile.chargingProfilePurpose': 1,
        'profile.stackLevel': 1,
      };
    }
    aggregation.push({ $sort: dbParams.sort });
    aggregation.push({ $skip: dbParams.skip });
    aggregation.push({ $limit: dbParams.limit });
    DatabaseUtils.projectFields(aggregation, projectFields);
    const chargingProfilesMDB = await global.database.getCollection<any>(tenant.id, 'chargingprofiles')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as ChargingProfile[];
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getChargingProfiles', startTime, aggregation, chargingProfilesMDB);
    return {
      count: DatabaseUtils.getCountFromDatabaseCount(chargingProfilesCountMDB[0]),
      result: chargingProfilesMDB
    };
  }

  public static async saveChargingProfile(tenant: Tenant, chargingProfileToSave: ChargingProfile): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const chargingProfileFilter: any = {};
    if (chargingProfileToSave.id) {
      chargingProfileFilter._id = chargingProfileToSave.id;
    } else {
      chargingProfileFilter._id =
        Utils.hash(`${chargingProfileToSave.chargingStationID}~${chargingProfileToSave.connectorID}~${chargingProfileToSave.profile.chargingProfileId}`);
    }
    const chargingProfileMDB: any = {
      _id: chargingProfileFilter._id,
      chargingStationID: chargingProfileToSave.chargingStationID,
      connectorID: Utils.convertToInt(chargingProfileToSave.connectorID),
      chargePointID: Utils.convertToInt(chargingProfileToSave.chargePointID),
      profile: chargingProfileToSave.profile
    };
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles').findOneAndUpdate(
      chargingProfileFilter,
      { $set: chargingProfileMDB },
      { upsert: true });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveChargingProfile', startTime, chargingProfileMDB);
    return chargingProfileFilter._id as string;
  }

  public static async deleteChargingProfile(tenant: Tenant, id: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles').findOneAndDelete({ '_id': id });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteChargingProfile', startTime, { id });
  }

  public static async deleteChargingProfiles(tenant: Tenant, chargingStationID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'chargingprofiles').findOneAndDelete({ 'chargingStationID': chargingStationID });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteChargingProfiles', startTime, { chargingStationID });
  }

  public static getChargingStationFirmware(filename: string): GridFSBucketReadStream {
    const startTime = Logging.traceDatabaseRequestStart();
    const bucket: GridFSBucket = global.database.getGridFSBucket('default.firmwares');
    const firmware = bucket.openDownloadStreamByName(filename);
    void Logging.traceDatabaseRequestEnd(Constants.DEFAULT_TENANT_OBJECT, MODULE_NAME, 'getChargingStationFirmware', startTime, filename, firmware);
    return firmware;
  }

  public static putChargingStationFirmware(filename: string): GridFSBucketWriteStream {
    const startTime = Logging.traceDatabaseRequestStart();
    const bucket: GridFSBucket = global.database.getGridFSBucket('default.firmwares');
    const firmware = bucket.openUploadStream(filename);
    void Logging.traceDatabaseRequestEnd(Constants.DEFAULT_TENANT_OBJECT, MODULE_NAME, 'putChargingStationFirmware', startTime, filename, firmware);
    return firmware;
  }

  public static async updateChargingStationsWithOrganizationIDs(tenant: Tenant, companyID: string, siteID: string, siteAreaID?: string): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    let result: UpdateResult;
    if (siteAreaID) {
      result = await global.database.getCollection<any>(tenant.id, 'chargingstations').updateMany(
        { siteAreaID: DatabaseUtils.convertToObjectID(siteAreaID) },
        { $set: { siteID: DatabaseUtils.convertToObjectID(siteID), companyID: DatabaseUtils.convertToObjectID(companyID) } }
      ) as UpdateResult;
    } else {
      result = await global.database.getCollection<any>(tenant.id, 'chargingstations').updateMany(
        { siteID: DatabaseUtils.convertToObjectID(siteID) },
        { $set: { companyID: DatabaseUtils.convertToObjectID(companyID) } }
      ) as UpdateResult;
    }
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'updateChargingStationsWithOrganizationIDs', startTime, { siteID, companyID, siteAreaID });
    return result.modifiedCount;
  }

  private static getChargerInErrorFacet(errorType: string) {
    switch (errorType) {
      case ChargingStationInErrorType.MISSING_SETTINGS:
        return [{
          $match: {
            $or: [
              { 'maximumPower': { $exists: false } }, { 'maximumPower': { $lte: 0 } }, { 'maximumPower': null },
              { 'chargePointModel': { $exists: false } }, { 'chargePointModel': { $eq: '' } },
              { 'chargePointVendor': { $exists: false } }, { 'chargePointVendor': { $eq: '' } },
              { 'powerLimitUnit': { $exists: false } }, { 'powerLimitUnit': null },
              { 'powerLimitUnit': { $nin: [ChargingRateUnitType.AMPERE, ChargingRateUnitType.WATT] } },
              { 'chargingStationURL': { $exists: false } }, { 'chargingStationURL': null }, { 'chargingStationURL': { $eq: '' } },
              { 'connectors.type': { $exists: false } }, { 'connectors.type': null }, { 'connectors.type': { $eq: '' } },
              { 'connectors.type': { $nin: [ConnectorType.CHADEMO, ConnectorType.COMBO_CCS, ConnectorType.DOMESTIC, ConnectorType.TYPE_1, ConnectorType.TYPE_1_CCS, ConnectorType.TYPE_2, ConnectorType.TYPE_3C] } },
            ]
          }
        }, { $addFields: { 'errorCode': ChargingStationInErrorType.MISSING_SETTINGS } }];
      case ChargingStationInErrorType.CONNECTION_BROKEN: {
        const inactiveDate = new Date(new Date().getTime() - Configuration.getChargingStationConfig().maxLastSeenIntervalSecs * 1000);
        return [
          { $match: { 'lastSeen': { $lte: inactiveDate } } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.CONNECTION_BROKEN } }
        ];
      }
      case ChargingStationInErrorType.CONNECTOR_ERROR:
        return [
          { $match: { $or: [{ 'connectors.errorCode': { $ne: 'NoError' } }, { 'connectors.status': { $eq: ChargePointStatus.FAULTED } }] } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.CONNECTOR_ERROR } }
        ];
      case ChargingStationInErrorType.MISSING_SITE_AREA:
        return [
          { $match: { $or: [{ 'siteAreaID': { $exists: false } }, { 'siteAreaID': null }] } },
          { $addFields: { 'errorCode': ChargingStationInErrorType.MISSING_SITE_AREA } }
        ];
      default:
        return [];
    }
  }

  private static filterConnectorMDB(connector: Connector): ConnectorMDB {
    if (connector) {
      const filteredConnector: ConnectorMDB = {
        id: connector.id,
        connectorId: Utils.convertToInt(connector.connectorId),
        currentInstantWatts: Utils.convertToFloat(connector.currentInstantWatts),
        currentStateOfCharge: connector.currentStateOfCharge,
        currentTotalInactivitySecs: Utils.convertToInt(connector.currentTotalInactivitySecs),
        currentTotalConsumptionWh: Utils.convertToFloat(connector.currentTotalConsumptionWh),
        currentTransactionDate: Utils.convertToDate(connector.currentTransactionDate),
        currentTagID: connector.currentTagID,
        currentTransactionID: Utils.convertToInt(connector.currentTransactionID),
        currentUserID: DatabaseUtils.convertToObjectID(connector.currentUserID),
        status: connector.status,
        errorCode: connector.errorCode,
        info: connector.info,
        vendorErrorCode: connector.vendorErrorCode,
        power: Utils.convertToInt(connector.power),
        type: connector.type,
        voltage: Utils.convertToInt(connector.voltage),
        amperage: Utils.convertToInt(connector.amperage),
        amperageLimit: Utils.convertToInt(connector.amperageLimit),
        statusLastChangedOn: Utils.convertToDate(connector.statusLastChangedOn),
        currentInactivityStatus: connector.currentInactivityStatus,
        numberOfConnectedPhase: connector.numberOfConnectedPhase,
        currentType: connector.currentType,
        chargePointID: connector.chargePointID,
        tariffID: connector.tariffID,
        tariffIDs: connector.tariffIDs,
        isPrivate: connector.isPrivate,
        ownerIds: connector.ownerIds,
        certificateIDs: connector.certificateIDs || [], // Ajout des certificateIDs au niveau du connecteur
        phaseAssignmentToGrid: connector.phaseAssignmentToGrid && {
          csPhaseL1: connector.phaseAssignmentToGrid.csPhaseL1,
          csPhaseL2: connector.phaseAssignmentToGrid.csPhaseL2,
          csPhaseL3: connector.phaseAssignmentToGrid.csPhaseL3,
        },
      };
      return filteredConnector;
    }
    return null;
  }

  private static filterChargePointMDB(chargePoint: ChargePoint): ChargePoint {
    if (chargePoint) {
      return {
        chargePointID: Utils.convertToInt(chargePoint.chargePointID),
        currentType: chargePoint.currentType,
        voltage: chargePoint.voltage ? Utils.convertToInt(chargePoint.voltage) : null,
        amperage: chargePoint.amperage ? Utils.convertToInt(chargePoint.amperage) : null,
        numberOfConnectedPhase: chargePoint.numberOfConnectedPhase ? Utils.convertToInt(chargePoint.numberOfConnectedPhase) : null,
        cannotChargeInParallel: Utils.convertToBoolean(chargePoint.cannotChargeInParallel),
        sharePowerToAllConnectors: Utils.convertToBoolean(chargePoint.sharePowerToAllConnectors),
        excludeFromPowerLimitation: Utils.convertToBoolean(chargePoint.excludeFromPowerLimitation),
        ocppParamForPowerLimitation: chargePoint.ocppParamForPowerLimitation,
        power: chargePoint.power ? Utils.convertToInt(chargePoint.power) : null,
        efficiency: chargePoint.efficiency ? Utils.convertToInt(chargePoint.efficiency) : null,
        connectorIDs: chargePoint.connectorIDs.map((connectorID) => Utils.convertToInt(connectorID)),
      };
    }
    return null;
  }
}