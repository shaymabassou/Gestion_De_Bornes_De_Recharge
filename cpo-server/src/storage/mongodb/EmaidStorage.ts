import Emaid, { ImportedEmaid } from '../../types/Emaid';
import global, { DatabaseCount, FilterParams, ImportStatus } from '../../types/GlobalType';

import Constants from '../../utils/Constants';
import { DataResult } from '../../types/DataResult';
import DatabaseUtils from './DatabaseUtils';
import DbParams from '../../types/database/DbParams';
import Logging from '../../utils/Logging';
import { ObjectId } from 'mongodb';
import { ServerAction } from '../../types/Server';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';
import moment from 'moment';

const MODULE_NAME = 'EmaidStorage';

export default class EmaidStorage {
public static async findAvailableID(tenant: Tenant): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    let existingEmaid: Emaid;
    do {
      // Generate new Emaid ID
      const id = Utils.generateEmaidID();
      existingEmaid = await EmaidStorage.getEmaid(tenant, id);
      if (existingEmaid) {
        await Logging.logWarning({
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'findAvailableID',
          action: ServerAction.EMAID_CREATE,
          message: `Emaid ID '${id}' already exists, generating a new one...`
        });
      } else {
        return id;
      }
    } while (existingEmaid);
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'findAvailableID', startTime, {});
  }

  public static async saveEmaid(tenant: Tenant, emaid: Emaid): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    const emaidMDB = {
      _id: emaid.id,
      userID: emaid.userID ? DatabaseUtils.convertToObjectID(emaid.userID) : null,
      issuer: Utils.convertToBoolean(emaid.issuer),
      active: Utils.convertToBoolean(emaid.active),
      //default: Utils.convertToBoolean(emaid.default),
      visualID: emaid.visualID ?? new ObjectId().toString(),
      //ocpiToken: emaid.ocpiToken,
      description: emaid.description,
      //importedData: emaid.importedData,
      //fromEMSP: (emaid.fromEMSP) ? Utils.convertToBoolean(emaid.fromEMSP) : false
    };
    // Check Created/Last Changed By
    DatabaseUtils.addLastChangedCreatedProps(emaidMDB, emaid);
    // Save
    await global.database.getCollection<any>(tenant.id, 'emaids').findOneAndUpdate(
      { '_id': emaid.id },
      { $set: emaidMDB },
      { upsert: true, returnDocument: 'after' });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveEmaid', startTime, emaidMDB);
  }

  public static async saveImportedEmaid(tenant: Tenant, importedEmaidToSave: ImportedEmaid): Promise<string> {
    const startTime = Logging.traceDatabaseRequestStart();
    const emaidMDB = {
      _id: importedEmaidToSave.id,
      visualID: importedEmaidToSave.visualID,
      description: importedEmaidToSave.description,
      name: importedEmaidToSave.name,
      firstName: importedEmaidToSave.firstName,
      email: importedEmaidToSave.email,
      status: importedEmaidToSave.status,
      errorDescription: importedEmaidToSave.errorDescription,
      importedOn: importedEmaidToSave.importedOn,
      importedBy: importedEmaidToSave.importedBy,
      siteIDs: importedEmaidToSave.siteIDs,
      importedData: importedEmaidToSave.importedData,
      //fromEMSP: (importedEmaidToSave.fromEMSP) ? Utils.convertToBoolean(importedEmaidToSave.fromEMSP) : false
    };
    await global.database.getCollection<any>(tenant.id, 'importedemaids').findOneAndUpdate(
      { _id: emaidMDB._id },
      { $set: emaidMDB },
      { upsert: true, returnDocument: 'after' }
    );
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveImportedEmaid', startTime, emaidMDB);
    return emaidMDB._id;
  }

  public static async saveImportedEmaids(tenant: Tenant, importedEmaidsToSave: ImportedEmaid[]): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    const importedEmaidsToSaveMDB: any = importedEmaidsToSave.map((importedEmaidToSave) => ({
      _id: importedEmaidToSave.id,
      visualID: importedEmaidToSave.visualID,
      description: importedEmaidToSave.description,
      name: importedEmaidToSave.name,
      firstName: importedEmaidToSave.firstName,
      email: importedEmaidToSave.email,
      status: importedEmaidToSave.status,
      errorDescription: importedEmaidToSave.errorDescription,
      // importedOn: importedEmaidToSave.importedOn,
      // importedBy: importedEmaidToSave.importedBy,
      siteIDs: importedEmaidToSave.siteIDs,
      importedData: importedEmaidToSave.importedData,
      //fromEMSP: (importedEmaidToSave.fromEMSP) ? Utils.convertToBoolean(importedEmaidToSave.fromEMSP) : false
    }));
    // Insert all at once
    const result = await global.database.getCollection<any>(tenant.id, 'importedemaids').insertMany(
      importedEmaidsToSaveMDB,
      { ordered: false }
    );
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'saveImportedEmaids', startTime, importedEmaidsToSave);
    return result.insertedCount;
  }

  public static async deleteImportedEmaid(tenant: Tenant, importedEmaidID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'importedemaids').deleteOne(
      {
        '_id': importedEmaidID,
      });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteImportedEmaid', startTime, { id: importedEmaidID });
  }

  public static async deleteImportedEmaids(tenant: Tenant): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'importedemaids').deleteMany({});
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteImportedEmaids', startTime, {});
  }

  public static async getImportedEmaidsCount(tenant: Tenant): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Count documents
    const nbrOfDocuments = await global.database.getCollection<any>(tenant.id, 'importedemaids').countDocuments();
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getImportedEmaidsCount', startTime, {});
    return nbrOfDocuments;
  }

  public static async getImportedEmaids(tenant: Tenant,
      params: { status?: ImportStatus; search?: string },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<ImportedEmaid>> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    const filters: FilterParams = {};
    // Create Aggregation
    const aggregation = [];
    // Filter
    if (params.search) {
      filters.$or = [
        { '_id': { $regex: params.search, $options: 'i' } },
        { 'visualID': { $regex: params.search, $options: 'i' } },
        { 'description': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Status
    if (params.status) {
      filters.status = params.status;
    }
    // Add filters
    aggregation.push({
      $match: filters
    });
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const emaidsImportCountMDB = await global.database.getCollection<any>(tenant.id, 'importedemaids')
      .aggregate([...aggregation, { $count: 'count' }], DatabaseUtils.buildAggregateOptions())
      .toArray() as DatabaseCount[];
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getImportedEmaids', startTime, aggregation, emaidsImportCountMDB);
      return {
        count: (emaidsImportCountMDB.length > 0 ? emaidsImportCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    // Sort
    if (!dbParams.sort) {
      dbParams.sort = { status: -1, name: 1, firstName: 1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Change ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'importedBy');
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const emaidsImportMDB = await global.database.getCollection<any>(tenant.id, 'importedemaids')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as ImportedEmaid[];
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getImportedEmaids', startTime, aggregation, emaidsImportMDB);
    return {
      count: DatabaseUtils.getCountFromDatabaseCount(emaidsImportCountMDB[0]),
      result: emaidsImportMDB
    };
  }

  public static async clearDefaultUserEmaid(tenant: Tenant, userID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    await global.database.getCollection<any>(tenant.id, 'emaids').updateMany(
      {
        userID: DatabaseUtils.convertToObjectID(userID),
        default: true
      },
      {
        $set: { default: false }
      });
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'clearDefaultUserEmaid', startTime, { userID });
  }

  public static async deleteEmaid(tenant: Tenant, emaidID: string): Promise<void> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    await global.database.getCollection<any>(tenant.id, 'emaids').deleteOne(
      {
        '_id': emaidID,
      }
    );
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteEmaid', startTime, { id: emaidID });
  }

  public static async deleteEmaidsByUser(tenant: Tenant, userID: string): Promise<number> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Delete
    const result = await global.database.getCollection<any>(tenant.id, 'emaids').deleteMany(
      {
        'userID': DatabaseUtils.convertToObjectID(userID),
      }
    );
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'deleteEmaidsByUser', startTime, { id: userID });
    return result.deletedCount;
  }

  public static async getEmaid(tenant: Tenant, id: string,
      params: { userIDs?: string[], withUser?: boolean, withNbrTransactions?: boolean, active?: boolean, siteIDs?: string[], issuer?: boolean } = {},
      projectFields?: string[]): Promise<Emaid> {
    const emaidMDB = await EmaidStorage.getEmaids(tenant, {
      emaidIDs: [id],
      withUser: params.withUser,
      withNbrTransactions: params.withNbrTransactions,
      userIDs: params.userIDs,
      active: params.active,
      siteIDs: params.siteIDs,
      issuer: params.issuer,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return emaidMDB.count === 1 ? emaidMDB.result[0] : null;
  }

  public static async getEmaidByVisualID(tenant: Tenant, visualID: string,
      params: { withUser?: boolean, withNbrTransactions?: boolean, userIDs?: string[], issuer?: boolean } = {}, projectFields?: string[]): Promise<Emaid> {
    const emaidMDB = await EmaidStorage.getEmaids(tenant, {
      visualIDs: [visualID],
      withUser: params.withUser,
      withNbrTransactions: params.withNbrTransactions,
      userIDs: params.userIDs,
      issuer: params.issuer
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return emaidMDB.count === 1 ? emaidMDB.result[0] : null;
  }

  public static async getFirstActiveUserEmaid(tenant: Tenant, userID: string,
      params: { issuer?: boolean; } = {}, projectFields?: string[]): Promise<Emaid> {
    const emaidMDB = await EmaidStorage.getEmaids(tenant, {
      userIDs: [userID],
      issuer: params.issuer,
      active: true,
    }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
    return emaidMDB.count > 0 ? emaidMDB.result[0] : null;
  }

  // public static async getDefaultUserEmaid(tenant: Tenant, userID: string,
  //     params: { issuer?: boolean; active?: boolean; } = {}, projectFields?: string[]): Promise<Emaid> {
  //   const emaidMDB = await EmaidStorage.getEmaids(tenant, {
  //     userIDs: [userID],
  //     issuer: params.issuer,
  //     active: params.active,
  //     defaultEmaid: true,
  //   }, Constants.DB_PARAMS_SINGLE_RECORD, projectFields);
  //   return emaidMDB.count === 1 ? emaidMDB.result[0] : null;
  // }

  public static async getEmaids(tenant: Tenant,
      params: {
        issuer?: boolean; emaidIDs?: string[]; visualIDs?: string[]; userIDs?: string[]; siteIDs?: string[]; dateFrom?: Date; dateTo?: Date;
        withUser?: boolean; withUsersOnly?: boolean; withNbrTransactions?: boolean; search?: string, defaultEmaid?: boolean, active?: boolean;
        //emsp?: { countryCode: string, partyID: string }
      },
      dbParams: DbParams, projectFields?: string[]): Promise<DataResult<Emaid>> {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Check Limit
    dbParams.limit = Utils.checkRecordLimit(dbParams.limit);
    // Check Skip
    dbParams.skip = Utils.checkRecordSkip(dbParams.skip);
    // Create Aggregation
    const aggregation = [];
    const filters: FilterParams = {};
    // Filter by other properties
    if (params.search) {
      filters.$or = [
        { '_id': { $regex: params.search, $options: 'i' } },
        { 'visualID': { $regex: params.search, $options: 'i' } },
        { 'description': { $regex: params.search, $options: 'i' } }
      ];
    }
    // Emaid IDs
    if (!Utils.isEmptyArray(params.emaidIDs)) {
      filters._id = { $in: params.emaidIDs };
    }
    // Visual Emaid IDs
    if (!Utils.isEmptyArray(params.visualIDs)) {
      filters.visualID = { $in: params.visualIDs };
    }
    // Users
    if (!Utils.isEmptyArray(params.userIDs)) {
      filters.userID = { $in: params.userIDs.map((userID) => DatabaseUtils.convertToObjectID(userID)) };
    }
    // Default Emaid
    if (params.defaultEmaid) {
      filters.default = true;
    }
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }
    // With Users only
    if (params.withUsersOnly) {
      filters.userID = { $exists: true, $ne: null };
    }
    // Active
    if (Utils.objectHasProperty(params, 'active') && Utils.isBoolean(params.active)) {
      filters.active = params.active;
    }
    // Dates
    if ((params.dateFrom && moment(params.dateFrom).isValid()) ||
        (params.dateTo && moment(params.dateTo).isValid())) {
      const lastChangedOn: any = {};
      const createdOn: any = {};
      if (params.dateFrom) {
        lastChangedOn.$gte = Utils.convertToDate(params.dateFrom);
        createdOn.$gte = Utils.convertToDate(params.dateFrom);
      }
      if (params.dateTo) {
        lastChangedOn.$lte = Utils.convertToDate(params.dateTo);
        createdOn.$lte = Utils.convertToDate(params.dateTo);
      }
      filters.$or = [
        { lastChangedOn },
        { createdOn },
      ];
    }

    // if (!Utils.isNullOrUndefined(params.emsp)) {
    //   filters['ocpiToken.issuer'] = `${params.emsp.countryCode}*${params.emsp.partyID}`;
    // }

    if (!Utils.isEmptyJSon(filters)) {
      aggregation.push({ $match: filters });
    }
    // Sites
    if (!Utils.isEmptyArray(params.siteIDs)) {
      DatabaseUtils.pushSiteUserLookupInAggregation({
        tenantID: tenant.id, aggregation, localField: 'userID', foreignField: 'userID', asField: 'siteUsers'
      });
      aggregation.push({
        $match: { 'siteUsers.siteID': { $in: params.siteIDs.map((site) => DatabaseUtils.convertToObjectID(site)) } }
      });
    }
    // Limit records?
    if (!dbParams.onlyRecordCount) {
      // Always limit the nbr of record to avoid perfs issues
      aggregation.push({ $limit: Constants.DB_RECORD_COUNT_CEIL });
    }
    // Count Records
    const emaidsCountMDB = await global.database.getCollection<any>(tenant.id, 'emaids')
      .aggregate([...aggregation, { $count: 'count' }], DatabaseUtils.buildAggregateOptions())
      .toArray() as DatabaseCount[];
    // Check if only the total count is requested
    if (dbParams.onlyRecordCount) {
      // Return only the count
      await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getEmaids', startTime, aggregation, emaidsCountMDB);
      return {
        count: (emaidsCountMDB.length > 0 ? emaidsCountMDB[0].count : 0),
        result: []
      };
    }
    // Remove the limit
    aggregation.pop();
    if (!dbParams.sort) {
      dbParams.sort = { createdOn: -1 };
    }
    aggregation.push({
      $sort: dbParams.sort
    });
    // Skip
    aggregation.push({
      $skip: dbParams.skip
    });
    // Limit
    aggregation.push({
      $limit: dbParams.limit
    });
    // Transactions
    if (params.withNbrTransactions) {
      let additionalPipeline: Record<string, any>[] = [];
      if (params.withUser) {
        additionalPipeline = [{
          '$match': { 'userID': { $exists: true, $ne: null } }
        }];
      }
      DatabaseUtils.pushTransactionsLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, localField: '_id', foreignField: 'emaidID',
        count: true, asField: 'transactionsCount', oneToOneCardinality: false,
        objectIDFields: ['createdBy', 'lastChangedBy']
      }, additionalPipeline);
    }
    // Users
    if (params.withUser) {
      DatabaseUtils.pushUserLookupInAggregation({
        tenantID: tenant.id, aggregation: aggregation, asField: 'user', localField: 'userID',
        foreignField: '_id', oneToOneCardinality: true, oneToOneCardinalityNotNull: false
      });
    }
    // Handle the ID
    DatabaseUtils.pushRenameDatabaseID(aggregation);
    // Convert Object ID to string
    DatabaseUtils.pushConvertObjectIDToString(aggregation, 'userID');
    // Add Created By / Last Changed By
    DatabaseUtils.pushCreatedLastChangedInAggregation(tenant.id, aggregation);
    // Project
    DatabaseUtils.projectFields(aggregation, projectFields);
    // Read DB
    const emaidsMDB = await global.database.getCollection<any>(tenant.id, 'emaids')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as Emaid[];
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getEmaids', startTime, aggregation, emaidsMDB);
    return {
      count: DatabaseUtils.getCountFromDatabaseCount(emaidsCountMDB[0]),
      result: emaidsMDB,
      projectFields: projectFields
    };
  }

  public static async getEmspsByEmaids(tenant: Tenant, params: { issuer?: boolean }, dbParams: DbParams, projectFields?: string[]) {
    const startTime = Logging.traceDatabaseRequestStart();
    DatabaseUtils.checkTenantObject(tenant);
    // Clone before updating the values
    dbParams = Utils.cloneObject(dbParams);
    // Create Aggregation
    const aggregation = [];
    const filters: FilterParams = {};
    // Issuer
    if (Utils.objectHasProperty(params, 'issuer') && Utils.isBoolean(params.issuer)) {
      filters.issuer = params.issuer;
    }

    if (!Utils.isEmptyJSon(filters)) {
      aggregation.push({ $match: filters });
    }

    if (!dbParams.sort) {
      dbParams.sort = { lastChangedOn: -1 };
    }
    aggregation.push({ $group: { _id: { "emspName": "$ocpiToken.issuer", lastChangedOn: "$lastChangedOn" } } })
    aggregation.push({
      $sort: { '_id.lastChangedOn': -1 }
    });

    // Read DB
    const emaidsMDB = await global.database.getCollection<any>(tenant.id, 'emaids')
      .aggregate<any>(aggregation, DatabaseUtils.buildAggregateOptions())
      .toArray() as any[];
    const fileteredEmaids = [...new Map(emaidsMDB.map(emaid => {
      let map = {
        emspName: emaid._id.emspName
      }
      return [map.emspName, map]
    })).values()]
    await Logging.traceDatabaseRequestEnd(tenant, MODULE_NAME, 'getEmspsByEmaids', startTime, aggregation, emaidsMDB);
    return {
      count: fileteredEmaids.length,
      result: fileteredEmaids,
      projectFields: ['emspName']
    };
  }
}