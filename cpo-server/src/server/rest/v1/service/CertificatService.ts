import { Action, Entity } from '../../../../types/Authorization';
import { DataResult } from '../../../../types/DataResult';
import { HTTPAuthError, HTTPError } from '../../../../types/HTTPError';
import { NextFunction, Request, Response } from 'express';
import { ServerAction } from '../../../../types/Server';
import { StatusCodes } from 'http-status-codes';

import AppAuthError from '../../../../exception/AppAuthError';
import AppError from '../../../../exception/AppError';
import AuthorizationService from './AuthorizationService';
import Authorizations from '../../../../authorization/Authorizations';
import Constants from '../../../../utils/Constants';
import Logging from '../../../../utils/Logging';
import LoggingHelper from '../../../../utils/LoggingHelper';
import Utils from '../../../../utils/Utils';
import UtilsService from './UtilsService';
import CertificateValidatorRest from '../validator/CertificateValidatorRest';
import { HttpCertificateDeleteRequest, HttpCertificatesGetRequest } from '../../../../types/requests/HttpCertificateRequest';
import UserToken from '../../../../types/UserToken';
import { ActionsResponse } from '../../../../types/GlobalType';
import Tenant from '../../../../types/Tenant';

import CertificateStorage from '../../../../storage/mongodb/CertificateStorage';
import { Certificate } from '../../../../types/Certificate';

const MODULE_NAME = 'CertificatService';

export default class CertificatService {
  public static async handleGetCertificate(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const certificateId = req.params.id;
      if (!certificateId) {
        throw new AppError({
          action,
          module: MODULE_NAME,
          method: 'handleGetCertificate',
          errorCode: HTTPError.GENERAL_ERROR,
          message: 'Certificate ID is required'
        });
      }

      await Logging.logDebug({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleGetCertificate',
        action,
        message: `Récupération du certificat avec ID: ${certificateId}`
      });

      const certificate = await UtilsService.checkAndGetCertificateAuthorization(
        req.tenant,
        req.user,
        certificateId,
        Action.READ,
        action,
        null,
        { withUser: req.query.WithUser === 'true' },
        true
      );

      res.json(certificate);
      next();
    } catch (error) {
      await Logging.logError({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleGetCertificate',
        action,
        message: `Erreur lors de la récupération du certificat: ${error.message}`,
        detailedMessages: { error: error.stack }
      });
      next(error);
    }
  }

  public static async handleGetCertificates(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filteredRequest = CertificateValidatorRest.getInstance().validateCertificatesGetReq(req.query);

      await Logging.logDebug({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleGetCertificates',
        action,
        message: 'Requête filtrée reçue',
        detailedMessages: { filteredRequest }
      });

      const certificates = await CertificatService.getCertificates(req, filteredRequest);
      res.json(certificates);
      next();
    } catch (error) {
      await Logging.logError({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleGetCertificates',
        action,
        message: `Erreur lors de la récupération des certificats: ${error.message}`,
        detailedMessages: { error: error.stack }
      });
      next(error);
    }
  }

  public static async handleDeleteCertificates(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const certificatesIDs = CertificateValidatorRest.getInstance().validateCertificatesDeleteReq(req.body).certificatesIDs;
      const result = await CertificatService.deleteCertificates(req.tenant, action, req.user, certificatesIDs);
      res.json({ ...result, ...Constants.REST_RESPONSE_SUCCESS });
      next();
    } catch (error) {
      await Logging.logError({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleDeleteCertificates',
        action,
        message: `Erreur lors de la suppression des certificats: ${error.message}`,
        detailedMessages: { error: error.stack }
      });
      next(error);
    }
  }

  public static async handleDeleteCertificate(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const certificateID = req.params.id;
      console.log(`Received certificateID from req.params.id: ${certificateID}`); // Log supplémentaire
      await Logging.logDebug({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleDeleteCertificate',
        action,
        message: `Received certificate ID from request: ${certificateID}`
      });
  
      if (!certificateID) {
        throw new AppError({
          action: ServerAction.CERTIFICATE_DELETE,
          module: MODULE_NAME,
          method: 'handleDeleteCertificate',
          errorCode: HTTPError.GENERAL_ERROR,
          message: 'Certificate ID is required'
        });
      }
  
      const certificate = await UtilsService.checkAndGetCertificateAuthorization(
        req.tenant,
        req.user,
        certificateID,
        Action.DELETE,
        action,
        null,
        {},
        true
      );
      console.log(`Certificate object returned: ${JSON.stringify(certificate)}`); // Log supplémentaire
      console.log(`certificate.id to be deleted: ${certificate.id}`); // Log spécifique pour certificate.id
  
      await CertificateStorage.deleteCertificate(req.tenant, certificate.id);
  
      await Logging.logDebug({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleDeleteCertificate',
        action,
        message: `Certificat avec ID: ${certificateID} supprimé avec succès`
      });
  
      res.json(Constants.REST_RESPONSE_SUCCESS);
      next();
    } catch (error) {
      await Logging.logError({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'handleDeleteCertificate',
        action,
        message: `Erreur lors de la suppression du certificat: ${error.message}`,
        detailedMessages: { error: error.stack }
      });
      next(error);
    }
  }



// public static async handleUnassignCertificates(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
//     const filteredRequest = CertificateValidatorRest.getInstance().validateCertificatesByIDsUnassignReq(req.body);
//     const result = await CertificatService.unassignCertificates(req.tenant, action, req.user, filteredRequest.visualIDs);
//     res.json({ ...result, ...Constants.REST_RESPONSE_SUCCESS });
//     next();
// }

// public static async handleUnassignCertificate(action: ServerAction, req: Request, res: Response, next: NextFunction): Promise<void> {
//     const filteredRequest = CertificateValidatorRest.getInstance().validateCertificateByIDUnassignReq(req.body);
//     const response = await CertificatService.unassignCertificate(req.tenant, action, req.user, [filteredRequest.visualID]);
//     if (response.inSuccess === 0) {
//     throw new AppError({
//         action: ServerAction.Certificate_UNASSIGN,
//         module: MODULE_NAME, method: 'handleUnassignCertificate',
//         errorCode: HTTPError.GENERAL_ERROR,
//         message: `Unable to unassign the Certificate ID '${filteredRequest.ID}'`
//     });
//     }
//     res.json(Constants.REST_RESPONSE_SUCCESS);
//     next();
// }


  private static async getCertificates(req: Request, filteredRequest: HttpCertificatesGetRequest): Promise<DataResult<Certificate>> {
    const authorizations = await AuthorizationService.checkAndGetCertificatesAuthorizations(
      req.tenant,
      req.user,
      filteredRequest,
      false
    );

    await Logging.logDebug({
      tenantID: req.tenant?.id,
      module: MODULE_NAME,
      method: 'getCertificates',
      action: ServerAction.CERTIFICATES,
      message: 'Autorisations vérifiées',
      detailedMessages: { authorizations }
    });

    if (!authorizations.authorized) {
      await Logging.logWarning({
        tenantID: req.tenant?.id,
        module: MODULE_NAME,
        method: 'getCertificates',
        action: ServerAction.CERTIFICATES,
        message: 'Utilisateur non autorisé à accéder aux certificats'
      });
      return Constants.DB_EMPTY_DATA_RESULT;
    }

    const certificates = await CertificateStorage.getCertificates(
      req.tenant,
      {
        search: filteredRequest.Search,
        certificateType: filteredRequest.CertificateType,
        status: filteredRequest.Status,
        ...authorizations.filters,
      },
      {
        limit: filteredRequest.Limit || 10,
        skip: filteredRequest.Skip || 0,
        sort: UtilsService.httpSortFieldsToMongoDB(filteredRequest.SortFields),
        onlyRecordCount: filteredRequest.OnlyRecordCount,
      },
      authorizations.projectFields
    );

    await Logging.logDebug({
      tenantID: req.tenant?.id,
      module: MODULE_NAME,
      method: 'getCertificates',
      action: ServerAction.CERTIFICATES,
      message: 'Certificats récupérés',
      detailedMessages: { count: certificates.count, resultLength: certificates.result.length }
    });

    if (authorizations.projectFields) {
      certificates.projectFields = authorizations.projectFields;
    }
    if (filteredRequest.WithAuth) {
      await AuthorizationService.addCertificatesAuthorizations(req.tenant, req.user, certificates as any, authorizations);
    }

    return certificates;
  }

  private static async deleteCertificates(tenant: Tenant, action: ServerAction, loggedUser: UserToken, certificatesIDs: string[]): Promise<ActionsResponse> {
    const result: ActionsResponse = {
      inSuccess: 0,
      inError: 0
    };
    for (const certificateID of certificatesIDs) {
      try {
        await Logging.logDebug({
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'deleteCertificates',
          action,
          message: `Tentative de suppression du certificat avec ID: ${certificateID} par l'utilisateur: ${loggedUser?.id} (rôle: ${loggedUser?.role})`
        });

        const certificate = await UtilsService.checkAndGetCertificateAuthorization(
          tenant,
          loggedUser,
          certificateID,
          Action.DELETE,
          action,
          null,
          {},
          true
        );
        await CertificateStorage.deleteCertificate(tenant, certificate.id);
        result.inSuccess++;

        await Logging.logDebug({
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'deleteCertificates',
          action,
          message: `Certificat avec ID: ${certificateID} supprimé avec succès`
        });
      } catch (error) {
        result.inError++;
        console.log(`Erreur lors de la suppression du certificat '${certificateID}':`, error); // Log temporaire pour debug
        await Logging.logError({
          tenantID: tenant.id,
          module: MODULE_NAME,
          method: 'deleteCertificates',
          action: ServerAction.CERTIFICATE_DELETE,
          message: `Échec de la suppression du certificat avec ID '${certificateID}': ${error.message}`,
          detailedMessages: { error: error.stack }
        });
      }
    }
    await Logging.logActionsResponse(
      loggedUser.tenantID,
      ServerAction.CERTIFICATES_DELETE,
      MODULE_NAME,
      'deleteCertificates',
      result,
      '{{inSuccess}} certificate(s) were successfully deleted',
      '{{inError}} certificate(s) failed to be deleted',
      '{{inSuccess}} certificate(s) were successfully deleted and {{inError}} failed to be deleted',
      'No certificates have been deleted',
      loggedUser
    );
    return result;
  }

 
  
}