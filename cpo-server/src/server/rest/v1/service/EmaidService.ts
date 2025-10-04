/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Action, Entity } from '../../../../types/Authorization';
import { ActionsResponse, ImportStatus } from '../../../../types/GlobalType';
import { AsyncTaskType, AsyncTasks } from '../../../../types/AsyncTask';
import Busboy, { FileInfo } from 'busboy';
import { DataResult } from '../../../../types/DataResult';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import { NextFunction, Request, Response } from 'express';
import Emaid, { ImportedEmaid, EmaidRequiredImportProperties } from '../../../../types/Emaid';
import Tenant from '../../../../types/Tenant';
import { Readable } from 'stream';
import pdfParse from 'pdf-parse'; // Pour l'OCR
import multer from 'multer';
//import { Multer } from 'multer';// Pour gérer l'upload de fichiers
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import AsyncTaskBuilder from '../../../../async-task/AsyncTaskBuilder';
import AuthorizationService from './AuthorizationService';
import Authorizations from '../../../../authorization/Authorizations';
import CSVError from 'csvtojson/v2/CSVError';
import Constants from '../../../../utils/Constants';
import { ImportedUser } from '../../../../types/User';
import JSONStream from 'JSONStream';
import LockingHelper from '../../../../locking/LockingHelper';
import LockingManager from '../../../../locking/LockingManager';
import Logging from '../../../../utils/Logging';
import LoggingHelper from '../../../../utils/LoggingHelper';
import { ServerAction } from '../../../../types/Server';
import { StatusCodes } from 'http-status-codes';
import EmaidStorage from '../../../../storage/mongodb/EmaidStorage';
import TenantStorage from '../../../../storage/mongodb/TenantStorage';
import UserToken from '../../../../types/UserToken';
import UserValidatorRest from '../validator/UserValidatorRest';
import Utils from '../../../../utils/Utils';
import UtilsSecurity from './security/UtilsSecurity';
import UtilsService from './UtilsService';
import csvToJson from 'csvtojson/v2';
import EmaidValidatorRest from '../validator/EmaidValidatorRest';
import { HttpEmaidsGetRequest } from '../../../../types/requests/HttpEmaidRequest';
import { file } from 'pdfkit';

const MODULE_NAME = 'EmaidService';

export default class EmaidService {
  public static async handleGetEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidGetReq(req.query);
    const emaid = await UtilsService.checkAndGetEmaidAuthorization(
      req.tenant, req.user, filteredRequest.ID, Action.READ, action, null, { withUser: filteredRequest.WithUser }, true);
    res.json(emaid);
    next();
  }

  public static async handleGetEmaids(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidsGetReq(req.query);
    res.json(await EmaidService.getEmaids(req, filteredRequest));
    next();
  }

  public static async handleDeleteEmaids(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const emaidsIDs = EmaidValidatorRest.getInstance().validateEmaidsDeleteReq(req.body).emaidsIDs;
    const result = await EmaidService.deleteEmaids(req.tenant, action, req.user, emaidsIDs);
    res.json({ ...result, ...Constants.REST_RESPONSE_SUCCESS });
    next();
  }

  public static async handleUnassignEmaids(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidsByVisualIDsUnassignReq(req.body);
    const result = await EmaidService.unassignEmaids(req.tenant, action, req.user, filteredRequest.visualIDs);
    res.json({ ...result, ...Constants.REST_RESPONSE_SUCCESS });
    next();
  }

  public static async handleUnassignEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidByVisualIDUnassignReq(req.body);
    const response = await EmaidService.unassignEmaids(req.tenant, action, req.user, [filteredRequest.visualID]);
    if (response.inSuccess === 0) {
      throw new AppError({
        action: ServerAction.EMAID_UNASSIGN,
        module: MODULE_NAME, method: 'handleUnassignEmaid',
        errorCode: HTTPError.GENERAL_ERROR,
        message: `Unable to unassign the Emaid visualID '${filteredRequest.visualID}'`
      });
    }
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleGetEmaidByVisualID(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidByVisualIDGetReq(req.query);
    const emaid = await UtilsService.checkAndGetEmaidByVisualIDAuthorization(
      req.tenant, req.user, filteredRequest.VisualID, Action.READ, action, null, { withUser: filteredRequest.WithUser }, true);
    res.json(emaid);
    next();
  }

  public static async handleDeleteEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidDeleteReq(req.query);
    const response = await EmaidService.deleteEmaids(req.tenant, action, req.user, [filteredRequest.ID]);
    if (response.inSuccess === 0) {
      throw new AppError({
        action: ServerAction.EMAID_DELETE,
        module: MODULE_NAME, method: 'handleDeleteEmaid',
        errorCode: HTTPError.GENERAL_ERROR,
        message: `Unable to delete the Emaid ID '${filteredRequest.ID}'`
      });
    }
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleCreateEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidCreateReq(req.body);
    await AuthorizationService.checkAndGetEmaidAuthorizations(req.tenant, req.user, {}, Action.CREATE, filteredRequest);
    let emaid = await EmaidStorage.getEmaid(req.tenant, filteredRequest.id.toUpperCase());
    if (emaid) {
      throw new AppError({
        ...LoggingHelper.getEmaidProperties(emaid),
        errorCode: HTTPError.EMAID_ALREADY_EXIST_ERROR,
        message: `Emaid with ID '${filteredRequest.id}' already exists`,
        module: MODULE_NAME, method: 'handleCreateEmaid',
        user: req.user,
        action: action
      });
    }
    emaid = await EmaidStorage.getEmaidByVisualID(req.tenant, filteredRequest.visualID);
    if (emaid) {
      throw new AppError({
        ...LoggingHelper.getEmaidProperties(emaid),
        errorCode: HTTPError.EMAID_VISUAL_ID_ALREADY_EXIST_ERROR,
        message: `Emaid with visual ID '${filteredRequest.visualID}' already exists`,
        module: MODULE_NAME, method: 'handleCreateEmaid',
        user: req.user,
        action: action
      });
    }
    if (filteredRequest.userID) {
      await UtilsService.checkAndGetUserAuthorization(req.tenant, req.user, filteredRequest.userID, Action.READ, ServerAction.EMAID_CREATE);
    }
    const newEmaid: Emaid = {
      id: filteredRequest.id.toUpperCase(),
      description: filteredRequest.description,
      visualID: filteredRequest.visualID,
      issuer: true,
      active: filteredRequest.active,
      userID: filteredRequest.userID,
      //transactionsCount: 0,
      createdBy: { id: req.user.id },
      createdOn: new Date()
    };
    await EmaidStorage.saveEmaid(req.tenant, newEmaid);
    await Logging.logInfo({
      ...LoggingHelper.getEmaidProperties(newEmaid),
      tenantID: req.tenant.id,
      action: action,
      user: req.user,
      module: MODULE_NAME, method: 'handleCreateEmaid',
      message: `Emaid with ID '${newEmaid.id}' has been created successfully`,
      detailedMessages: { emaid: newEmaid }
    });
    res.status(StatusCodes.CREATED).json(Object.assign({ id: newEmaid.id }, Constants.REST_RESPONSE_SUCCESS));
    next();
  }

  public static async handleAssignEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidAssignReq(req.body);
    console.log("Rôle dans handleAssignEmaid :", req.user.role, "Action :", Action.ASSIGN);
    const emaid = await UtilsService.checkAndGetEmaidByVisualIDAuthorization(req.tenant, req.user, filteredRequest.visualID, Action.ASSIGN, action,
      filteredRequest, { withNbrTransactions: true, withUser: true });
    if (!emaid) {
      throw new AppError({
        ...LoggingHelper.getEmaidProperties(emaid),
        errorCode: HTTPError.EMAID_VISUAL_ID_DOES_NOT_MATCH_EMAID_ERROR,
        message: `Emaid with visual ID '${filteredRequest.visualID}' does not match any emaid`,
        module: MODULE_NAME, method: 'handleAssignEmaid',
        user: req.user,
        action: action
      });
    }
    if (!emaid.active) {
      throw new AppError({
        ...LoggingHelper.getEmaidProperties(emaid),
        errorCode: HTTPError.EMAID_INACTIVE,
        message: `Emaid with visual ID '${filteredRequest.visualID}' is not active and cannot be assigned`,
        module: MODULE_NAME, method: 'handleAssignEmaid',
        user: req.user,
        action: action
      });
    }
    if (emaid.user) {
      throw new AppError({
        ...LoggingHelper.getEmaidProperties(emaid),
        errorCode: HTTPError.EMAID_ALREADY_EXIST_ERROR,
        message: `Emaid with ID '${filteredRequest.id}' is already assigned to another user`,
        module: MODULE_NAME, method: 'handleAssignEmaid',
        user: req.user,
        action: action
      });
    }
    const user = await UtilsService.checkAndGetUserAuthorization(req.tenant, req.user, filteredRequest.userID, Action.READ, ServerAction.EMAID_ASSIGN);
    emaid.userID = filteredRequest.userID;
    emaid.description = filteredRequest.description;
    emaid.lastChangedBy = { id: req.user.id };
    emaid.lastChangedOn = new Date();
    await EmaidStorage.saveEmaid(req.tenant, emaid);
    await Logging.logInfo({
      ...LoggingHelper.getEmaidProperties(emaid),
      tenantID: req.tenant.id,
      action: action,
      user: req.user, actionOnUser: user,
      module: MODULE_NAME, method: 'handleAssignEmaid',
      message: `Emaid with ID '${emaid.id}' has been assigned successfully`,
      detailedMessages: { emaid: emaid }
    });
    res.status(StatusCodes.CREATED).json(Object.assign({ id: emaid.id }, Constants.REST_RESPONSE_SUCCESS));
    next();
  }

  public static async handleUpdateEmaidByVisualID(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidVisualIDUpdateReq(req.body);
    const emaid = await UtilsService.checkAndGetEmaidByVisualIDAuthorization(req.tenant, req.user, filteredRequest.visualID, Action.UPDATE_BY_VISUAL_ID, action,
      filteredRequest, { withNbrTransactions: true, withUser: true });
    emaid.description = filteredRequest.description;
    emaid.lastChangedBy = { id: req.user.id };
    emaid.lastChangedOn = new Date();
    await EmaidStorage.saveEmaid(req.tenant, emaid);
    await Logging.logInfo({
      ...LoggingHelper.getEmaidProperties(emaid),
      tenantID: req.tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleUpdateEmaidByVisualID',
      message: `Emaid with ID '${emaid.id}' has been updated successfully`,
      user: req.user, actionOnUser: emaid.user,
      detailedMessages: { emaid: emaid }
    });
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleUpdateEmaid(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidUpdateReq({ ...req.params, ...req.body });
    const emaid = await UtilsService.checkAndGetEmaidAuthorization(req.tenant, req.user, filteredRequest.id, Action.UPDATE, action,
      filteredRequest, { withUser: true }, true);
    if (filteredRequest.userID) {
      await UtilsService.checkAndGetUserAuthorization(req.tenant, req.user, filteredRequest.userID, Action.READ, ServerAction.EMAID_UPDATE);
    }
    if (emaid.visualID !== filteredRequest.visualID) {
      const emaidVisualID = await EmaidStorage.getEmaidByVisualID(req.tenant, filteredRequest.visualID);
      if (emaidVisualID) {
        throw new AppError({
          ...LoggingHelper.getEmaidProperties(emaid),
          errorCode: HTTPError.EMAID_VISUAL_ID_ALREADY_EXIST_ERROR,
          message: `Emaid with Visual ID '${filteredRequest.visualID}' already exists`,
          module: MODULE_NAME, method: 'handleUpdateEmaid',
          user: req.user,
          action: action
        });
      }
    }
    let formerEmaidUserID: string;
    if (emaid.userID !== filteredRequest.userID) {
      formerEmaidUserID = emaid.userID;
    }
    emaid.visualID = filteredRequest.visualID;
    emaid.description = filteredRequest.description;
    emaid.active = filteredRequest.active;
    emaid.userID = filteredRequest.userID;
    emaid.lastChangedBy = { id: req.user.id };
    emaid.lastChangedOn = new Date();
    await EmaidStorage.saveEmaid(req.tenant, emaid);
    await Logging.logInfo({
      ...LoggingHelper.getEmaidProperties(emaid),
      tenantID: req.tenant.id,
      action: action,
      module: MODULE_NAME, method: 'handleUpdateEmaid',
      message: `Emaid with ID '${emaid.id}' has been updated successfully`,
      user: req.user,
      detailedMessages: { emaid: emaid }
    });
    res.json(Constants.REST_RESPONSE_SUCCESS);
    next();
  }

  public static async handleImportEmaids(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!(await Authorizations.canImportEmaids(req.user)).authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.IMPORT, entity: Entity.EMAID,
        module: MODULE_NAME, method: 'handleImportEmaids'
      });
    }
    const importEmaidsLock = await LockingHelper.acquireImportEmaidsLock(req.tenant.id);
    if (!importEmaidsLock) {
      throw new AppError({
        action: action,
        errorCode: HTTPError.CANNOT_ACQUIRE_LOCK,
        module: MODULE_NAME, method: 'handleImportEmaids',
        message: 'Error in importing the Emaids: cannot acquire the lock',
        user: req.user
      });
    }
    try {
      const importedBy = req.user.id;
      const importedOn = new Date();
      const emaidsToBeImported: ImportedEmaid[] = [];
      const startTime = new Date().getTime();
      const result: ActionsResponse = {
        inSuccess: 0,
        inError: 0
      };
      await EmaidStorage.deleteImportedEmaids(req.tenant);
      const busboy = Busboy({ headers: req.headers });
      req.pipe(busboy);
      let connectionClosed = false;
      req.socket.on('close', async () => {
        if (!connectionClosed) {
          connectionClosed = true;
          await LockingManager.release(importEmaidsLock);
        }
      });
      await new Promise((resolve, reject) => {
        busboy.on('file', async (fileName: string, fileStream: Readable, fileInfo: FileInfo) => {
          if (fileInfo.filename.slice(-4) === '.csv') {
            const converter = csvToJson({
              trim: true,
              delimiter: Constants.CSV_SEPARATOR,
              output: 'json',
            });
            void converter.subscribe(async (emaid: ImportedEmaid) => {
              if (connectionClosed) {
                reject(new Error('HTTP connection has been closed'));
              }
              const emaidKeys = Object.keys(emaid);
              if (!EmaidRequiredImportProperties.every((property) => emaidKeys.includes(property))) {
                if (!res.headersSent) {
                  res.writeHead(HTTPError.INVALID_FILE_CSV_HEADER_FORMAT);
                  res.end();
                  resolve();
                }
                reject(new Error(`Missing one of required properties: '${EmaidRequiredImportProperties.join(', ')}'`));
              }
              emaid.importedBy = importedBy;
              emaid.importedOn = importedOn;
              const importSuccess = await EmaidService.processEmaid(action, req, emaid, emaidsToBeImported);
              if (!importSuccess) {
                result.inError++;
              }
              if (!Utils.isEmptyArray(emaidsToBeImported) && (emaidsToBeImported.length % Constants.IMPORT_BATCH_INSERT_SIZE) === 0) {
                await EmaidService.insertEmaids(req.tenant, req.user, action, emaidsToBeImported, result);
              }
            }, async (error: CSVError) => {
              await LockingManager.release(importEmaidsLock);
              await Logging.logError({
                tenantID: req.tenant.id,
                module: MODULE_NAME, method: 'handleImportEmaids',
                action: action,
                user: req.user.id,
                message: `Exception while parsing the CSV '${fileInfo.filename}': ${error.message}`,
                detailedMessages: { error: error.stack }
              });
              if (!res.headersSent) {
                res.writeHead(HTTPError.INVALID_FILE_FORMAT);
                res.end();
                resolve();
              }
            }, async () => {
              connectionClosed = true;
              if (emaidsToBeImported.length > 0) {
                await EmaidService.insertEmaids(req.tenant, req.user, action, emaidsToBeImported, result);
              }
              await LockingManager.release(importEmaidsLock);
              const executionDurationSecs = Utils.truncTo((new Date().getTime() - startTime) / 1000, 2);
              await Logging.logActionsResponse(
                req.tenant.id, action,
                MODULE_NAME, 'handleImportEmaids', result,
                `{{inSuccess}} Emaid(s) were successfully uploaded in ${executionDurationSecs}s and ready for asynchronous import`,
                `{{inError}} Emaid(s) failed to be uploaded in ${executionDurationSecs}s`,
                `{{inSuccess}} Emaid(s) were successfully uploaded in ${executionDurationSecs}s and ready for asynchronous import and {{inError}} failed to be uploaded`,
                `No Emaid have been uploaded in ${executionDurationSecs}s`, req.user
              );
              await AsyncTaskBuilder.createAndSaveAsyncTasks({
                name: AsyncTasks.EMAIDS_IMPORT,
                action: ServerAction.EMAIDS_IMPORT,
                type: AsyncTaskType.TASK,
                tenantID: req.tenant.id,
                module: MODULE_NAME,
                method: 'handleImportEmaids',
              });
              if (!res.headersSent) {
                res.json({ ...result, ...Constants.REST_RESPONSE_SUCCESS });
              }
              next();
              resolve();
            });
            void fileStream.pipe(converter);
          } else if (fileInfo.encoding === 'application/json') {
            const parser = JSONStream.parse('emaids.*');
            parser.on('data', async (emaid: ImportedEmaid) => {
              emaid.importedBy = importedBy;
              emaid.importedOn = importedOn;
              const importSuccess = await EmaidService.processEmaid(action, req, emaid, emaidsToBeImported);
              if (!importSuccess) {
                result.inError++;
              }
              if ((emaidsToBeImported.length % Constants.IMPORT_BATCH_INSERT_SIZE) === 0) {
                await EmaidService.insertEmaids(req.tenant, req.user, action, emaidsToBeImported, result);
              }
            });
            parser.on('error', async (error) => {
              await LockingManager.release(importEmaidsLock);
              await Logging.logError({
                tenantID: req.tenant.id,
                module: MODULE_NAME, method: 'handleImportEmaids',
                action: action,
                user: req.user.id,
                message: `Invalid Json file '${fileInfo.filename}'`,
                detailedMessages: { error: error.stack }
              });
              if (!res.headersSent) {
                res.writeHead(HTTPError.INVALID_FILE_FORMAT);
                res.end();
                resolve();
              }
            });
            fileStream.pipe(parser);
          } else {
            await LockingManager.release(importEmaidsLock);
            await Logging.logError({
              tenantID: req.tenant.id,
              module: MODULE_NAME, method: 'handleImportEmaids',
              action: action,
              user: req.user.id,
              message: `Invalid file format '${fileInfo.mimeType}'`
            });
            if (!res.headersSent) {
              res.writeHead(HTTPError.INVALID_FILE_FORMAT);
              res.end();
              resolve();
            }
          }
        });
      });
    } finally {
      await LockingManager.release(importEmaidsLock);
    }
  }

  public static async handleExportEmaids(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!(await Authorizations.canExportEmaids(req.user)).authorized) {
      throw new AppAuthError({
        errorCode: HTTPAuthError.FORBIDDEN,
        user: req.user,
        action: Action.EXPORT, entity: Entity.EMAID,
        module: MODULE_NAME, method: 'handleExportEmaids'
      });
    }
    req.query.Limit = Constants.EXPORT_PAGE_SIZE.toString();
    const filteredRequest = EmaidValidatorRest.getInstance().validateEmaidsGetReq(req.query);
    await UtilsService.exportToCSV(req, res, 'exported-emaids.csv', filteredRequest,
      EmaidService.getEmaids.bind(this),
      EmaidService.convertToCSV.bind(this));
  }

  public static async handleProcessPDF(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      console.log('Début de handleProcessPDF');
      const tempDir = path.join(os.tmpdir(), 'emaid-temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log('Répertoire temporaire créé:', tempDir);
      }

      const upload = multer({
        storage: multer.diskStorage({
          destination: tempDir,
          filename: (req, file, cb) => {
            cb(null, `pdf-upload-${Date.now()}${path.extname(file.originalname)}`);
          },
        }),
        fileFilter: (req, file, cb) => {
          if (file.mimetype === 'application/pdf') {
            cb(null, true);
          } else {
            cb(
              new AppError({
                errorCode: HTTPError.GENERAL_ERROR,
                message: 'Seuls les fichiers PDF sont autorisés',
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              })
            );
          }
        },
        limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      }).single('file');

      // Vérification des autorisations
      await AuthorizationService.checkAndGetEmaidAuthorizations(req.tenant, req.user, {}, Action.CREATE, {});
      console.log('Autorisations vérifiées');

      upload(req, res, async (err) => {
        try {
          console.log('Upload middleware appelé');
          if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
              throw new AppError({
                errorCode: HTTPError.FILE_TOO_LARGE,
                message: 'La taille du fichier dépasse la limite de 5 Mo',
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }
            throw new AppError({
              errorCode: HTTPError.GENERAL_ERROR,
              message: `Erreur lors de l'upload du fichier : ${err.message}`,
              module: MODULE_NAME,
              method: 'handleProcessPDF',
              user: req.user,
              action,
              detailedMessages: { error: err.stack },
            });
          }

          const file = req.file;
          console.log('Fichier reçu:', file?.originalname);
          if (!file) {
            throw new AppError({
              errorCode: HTTPError.GENERAL_ERROR,
              message: 'Aucun fichier PDF n’a été téléchargé',
              module: MODULE_NAME,
              method: 'handleProcessPDF',
              user: req.user,
              action,
            });
          }

          console.log('Type MIME:', file.mimetype);
          if (file.mimetype !== 'application/pdf') {
            fs.unlinkSync(file.path);
            throw new AppError({
              errorCode: HTTPError.GENERAL_ERROR,
              message: `Fichier invalide : doit être un PDF, reçu ${file.mimetype}`,
              module: MODULE_NAME,
              method: 'handleProcessPDF',
              user: req.user,
              action,
            });
          }

          // Extraction du texte avec pdf-parse
          try {
            console.log('Extraction du texte du PDF');
            const pdfBuffer = fs.readFileSync(file.path);
            console.log('Taille du buffer PDF:', pdfBuffer.length);
            const data = await pdfParse(pdfBuffer); // Appel correct de la fonction
            const text = data.text;
            console.log('Texte extrait:', text);

            // Nettoyage du fichier temporaire
            fs.unlinkSync(file.path);
            console.log('Fichier temporaire supprimé');

            // Extraction des données
            const extractedData: Emaid = {
              id: '',
              visualID: '',
              description: '',
              active: true,
              issuer: true,
              //transactionsCount: 0,
              createdBy: { id: req.user.id },
              createdOn: new Date(),
            };

            const idMatch = text.match(/ID:\s*([a-zA-Z0-9]+)/i);
            const visualIDMatch = text.match(/Visual ID:\s*([a-zA-Z0-9]+)/i);
            const descriptionMatch = text.match(/Description:\s*(.+)/i);
            const activeMatch = text.match(/Active:\s*(true|false)/i);

            extractedData.id = idMatch ? idMatch[1].toUpperCase() : '';
            extractedData.visualID = visualIDMatch ? visualIDMatch[1] : '';
            extractedData.description = descriptionMatch ? descriptionMatch[1].trim() : '';
            extractedData.active = activeMatch ? activeMatch[1].toLowerCase() === 'true' : true;

            console.log('Données extraites:', extractedData);

            // Validation des données
            if (!extractedData.id || !/^[a-zA-Z0-9]*$/.test(extractedData.id)) {
              throw new AppError({
                errorCode: HTTPError.GENERAL_ERROR,
                message: 'ID invalide extrait du PDF',
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }
            if (!extractedData.visualID) {
              throw new AppError({
                errorCode: HTTPError.GENERAL_ERROR,
                message: 'Visual ID manquant dans le PDF',
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }
            if (!extractedData.description) {
              throw new AppError({
                errorCode: HTTPError.GENERAL_ERROR,
                message: 'Description manquante dans le PDF',
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }

            // Vérification des doublons
            console.log('Vérification doublons');
            let emaid = await EmaidStorage.getEmaid(req.tenant, extractedData.id);
            if (emaid) {
              throw new AppError({
                ...LoggingHelper.getEmaidProperties(emaid),
                errorCode: HTTPError.EMAID_ALREADY_EXIST_ERROR,
                message: `Emaid avec ID '${extractedData.id}' existe déjà`,
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }
            emaid = await EmaidStorage.getEmaidByVisualID(req.tenant, extractedData.visualID);
            if (emaid) {
              throw new AppError({
                ...LoggingHelper.getEmaidProperties(emaid),
                errorCode: HTTPError.EMAID_VISUAL_ID_ALREADY_EXIST_ERROR,
                message: `Emaid avec visual ID '${extractedData.visualID}' existe déjà`,
                module: MODULE_NAME,
                method: 'handleProcessPDF',
                user: req.user,
                action,
              });
            }

            // Sauvegarde de l'Emaid
            console.log('Sauvegarde Emaid');
            await EmaidStorage.saveEmaid(req.tenant, extractedData);
            await Logging.logInfo({
              ...LoggingHelper.getEmaidProperties(extractedData),
              tenantID: req.tenant.id,
              action,
              user: req.user,
              module: MODULE_NAME,
              method: 'handleProcessPDF',
              message: `Emaid avec ID '${extractedData.id}' a été créé avec succès à partir du PDF`,
              detailedMessages: { emaid: extractedData },
            });

            res.status(StatusCodes.CREATED).json({
              id: extractedData.id,
              ...Constants.REST_RESPONSE_SUCCESS,
            });
            next();
          } catch (error) {
            if (file && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
            console.error('Erreur lors de l’extraction du texte:', error.message, error.stack);
            throw new AppError({
              errorCode: HTTPError.GENERAL_ERROR,
              message: `Erreur lors de l’extraction du texte du PDF : ${error.message}`,
              module: MODULE_NAME,
              method: 'handleProcessPDF',
              user: req.user,
              action,
              detailedMessages: { error: error.stack },
            });
          }
        } catch (error) {
          console.error('Erreur dans upload middleware:', error.message, error.stack);
          next(error);
        }
      });
    } catch (error) {
      console.error('Erreur dans handleProcessPDF:', error.message, error.stack);
      next(error);
    }
  }
  private static async insertEmaids(tenant: Tenant, user: UserToken, action: ServerAction, emaidsToBeImported: ImportedEmaid[], result: ActionsResponse): Promise<void> {
    try {
      const nbrInsertedEmaids = await EmaidStorage.saveImportedEmaids(tenant, emaidsToBeImported);
      result.inSuccess += nbrInsertedEmaids;
    } catch (error) {
      result.inSuccess += error.result.nInserted;
      result.inError += error.writeErrors.length;
      await Logging.logError({
        tenantID: tenant.id,
        module: MODULE_NAME, method: 'insertEmaids',
        action: action,
        user: user.id,
        message: `Cannot import ${error.writeErrors.length as number} emaids!`,
        detailedMessages: { error: error.stack, emaidsError: error.writeErrors }
      });
    }
    emaidsToBeImported.length = 0;
  }

  private static async deleteEmaids(tenant: Tenant, action: ServerAction, loggedUser: UserToken, emaidsIDs: string[]): Promise<ActionsResponse> {
    const result: ActionsResponse = {
      inSuccess: 0,
      inError: 0
    };
    for (const emaidID of emaidsIDs) {
      try {
        const emaid = await UtilsService.checkAndGetEmaidAuthorization(
          tenant, loggedUser, emaidID, Action.DELETE, action, null, {}, true);
        await EmaidStorage.deleteEmaid(tenant, emaid.id);
        result.inSuccess++;
      } catch (error) {
        result.inError++;
        await Logging.logError({
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'deleteEmaids',
          action: ServerAction.EMAID_DELETE,
          message: `Unable to delete the Emaid ID '${emaidID}'`,
          detailedMessages: { error: error.stack }
        });
      }
    }
    await Logging.logActionsResponse(loggedUser.tenantID,
      ServerAction.EMAIDS_DELETE,
      MODULE_NAME, 'handleDeleteEmaids', result,
      '{{inSuccess}} emaid(s) were successfully deleted',
      '{{inError}} emaid(s) failed to be deleted',
      '{{inSuccess}} emaid(s) were successfully deleted and {{inError}} failed to be deleted',
      'No emaids have been deleted', loggedUser
    );
    return result;
  }

  private static async unassignEmaids(tenant: Tenant, action: ServerAction, loggedUser: UserToken, visualIDs: string[]): Promise<ActionsResponse> {
    const result: ActionsResponse = {
      inSuccess: 0,
      inError: 0
    };
    for (const visualID of visualIDs) {
      try {
        const emaid = await UtilsService.checkAndGetEmaidByVisualIDAuthorization(
          tenant, loggedUser, visualID, Action.UNASSIGN, action, null, {});
        emaid.userID = null;
        emaid.active = false;
        await EmaidStorage.saveEmaid(tenant, emaid);
        result.inSuccess++;
      } catch (error) {
        result.inError++;
        await Logging.logError({
          tenantID: tenant.id,
          module: MODULE_NAME, method: 'unassignEmaids',
          action: ServerAction.EMAID_DELETE,
          message: `Unable to unassign the Emaid with visual ID '${visualID}'`,
          detailedMessages: { error: error.stack }
        });
      }
    }
    await Logging.logActionsResponse(loggedUser.tenantID,
      ServerAction.EMAIDS_DELETE,
      MODULE_NAME, 'unassignEmaids', result,
      '{{inSuccess}} emaid(s) were successfully unassigned',
      '{{inError}} emaid(s) failed to be unassigned',
      '{{inSuccess}} emaid(s) were successfully unassigned and {{inError}} failed to be unassigned',
      'No emaids have been unassigned', loggedUser
    );
    return result;
  }

  private static convertToCSV(req: Request, emaids: Emaid[], writeHeader = true): string {
    let headers = null;
    if (writeHeader) {
      headers = [
        'id',
        'visualID',
        'description',
        'firstName',
        'name',
        'email'
      ].join(Constants.CSV_SEPARATOR);
    }
    const rows = emaids.map((emaid) => {
      const row = [
        emaid.id,
        emaid.visualID,
        emaid.description,
        emaid.user?.firstName,
        emaid.user?.name,
        emaid.user?.email
      ].map((value) => Utils.escapeCsvValue(value));
      return row;
    }).join(Constants.CR_LF);
    return Utils.isNullOrUndefined(headers) ? Constants.CR_LF + rows : [headers, rows].join(Constants.CR_LF);
  }

  private static async getEmaids(req: Request, filteredRequest: HttpEmaidsGetRequest): Promise<DataResult<Emaid>> {
    const authorizations = await AuthorizationService.checkAndGetEmaidsAuthorizations(req.tenant, req.user, filteredRequest, false);
    if (!authorizations.authorized) {
      return Constants.DB_EMPTY_DATA_RESULT;
    }
    const emaids = await EmaidStorage.getEmaids(req.tenant,
      {
        search: filteredRequest.Search,
        issuer: filteredRequest.Issuer,
        active: filteredRequest.Active,
        withUser: filteredRequest.WithUser,
        userIDs: filteredRequest.UserID ? filteredRequest.UserID.split('|') : null,
        ...authorizations.filters
      },
      {
        limit: filteredRequest.Limit,
        skip: filteredRequest.Skip,
        sort: UtilsService.httpSortFieldsToMongoDB(filteredRequest.SortFields),
        onlyRecordCount: filteredRequest.OnlyRecordCount
      },
      authorizations.projectFields
    );
    if (authorizations.projectFields) {
      emaids.projectFields = authorizations.projectFields;
    }
    if (filteredRequest.WithAuth) {
      await AuthorizationService.addEmaidsAuthorizations(req.tenant, req.user, emaids as any, authorizations);
    }
    return emaids;
  }

  private static async processEmaid(action: ServerAction, req: Request, importedEmaid: ImportedEmaid, emaidsToBeImported: ImportedEmaid[]): Promise<boolean> {
    try {
      const newImportedEmaid: ImportedEmaid = {
        id: importedEmaid.id.toUpperCase(),
        visualID: importedEmaid.visualID,
        description: importedEmaid.description || `Emaid ID '${importedEmaid.id}'`
      };
      EmaidValidatorRest.getInstance().validateImportedEmaidCreateReq(newImportedEmaid);
      newImportedEmaid.importedBy = importedEmaid.importedBy;
      newImportedEmaid.importedOn = importedEmaid.importedOn;
      newImportedEmaid.status = ImportStatus.READY;
      let emaidToImport = newImportedEmaid;
      if (importedEmaid.name && importedEmaid.firstName && importedEmaid.email) {
        const newImportedUser: ImportedUser = {
          name: importedEmaid.name.toUpperCase(),
          firstName: importedEmaid.firstName,
          email: importedEmaid.email,
          siteIDs: importedEmaid.siteIDs
        };
        try {
          UserValidatorRest.getInstance().validateUserImportCreateReq(newImportedUser);
          emaidToImport = { ...emaidToImport, ...newImportedUser as ImportedEmaid };
        } catch (error) {
          await Logging.logWarning({
            tenantID: req.tenant.id,
            module: MODULE_NAME, method: 'processEmaid',
            action: action,
            message: `User cannot be imported with emaid ${newImportedEmaid.id}`,
            detailedMessages: { emaid: newImportedEmaid, error: error.message, stack: error.stack }
          });
        }
      }
      emaidsToBeImported.push(emaidToImport);
      return true;
    } catch (error) {
      await Logging.logError({
        tenantID: req.tenant.id,
        module: MODULE_NAME, method: 'processEmaid',
        action: action,
        message: `Emaid ID '${importedEmaid.id}' cannot be imported`,
        detailedMessages: { emaid: importedEmaid, error: error.stack }
      });
      return false;
    }
  }
}

function pdf(dataBuffer: Buffer) {
    throw new Error('Function not implemented.');
}
