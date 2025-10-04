import { RESTServerRoute, ServerAction } from '../../../../../types/Server';
import express, { NextFunction, Request, Response } from 'express';
import RouterUtils from '../../../../../utils/RouterUtils';
import CertificatService from '../../service/CertificatService';
import { CertificateService } from '../../../../ocpp/services/CertificateService';

export default class CertificateRouter {
  private router: express.Router;

  public constructor() {
    this.router = express.Router();
  }

  public buildRoutes(): express.Router {
    this.buildRouteCertificates();
    this.buildRouteGetCertificate();
    this.buildRouteDeleteCertificate();
    // this.buildRouteAssignCertificate();
    return this.router;
  }

  private buildRouteCertificates(): void {
    this.router.get(`/${RESTServerRoute.REST_CERTIFICATES}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(
        CertificatService.handleGetCertificates.bind(this),
        ServerAction.CERTIFICATES,
        req,
        res,
        next
      );
    });
  }

  private buildRouteGetCertificate(): void {
    this.router.get(`/${RESTServerRoute.REST_CERTIFICATE}`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(
        CertificatService.handleGetCertificate.bind(this),
        ServerAction.CERTIFICATE,
        req,
        res,
        next
      );
    });
  }

  private buildRouteDeleteCertificate(): void {
    this.router.delete(`/${RESTServerRoute.REST_CERTIFICATE}`, (req: Request, res: Response, next: NextFunction) => {
      console.log(`Received DELETE request with params: ${JSON.stringify(req.params)}`); // Log temporaire
      void RouterUtils.handleRestServerAction(
        CertificatService.handleDeleteCertificate.bind(this),
        ServerAction.CERTIFICATE_DELETE,
        req,
        res,
        next
      );
    });
  }


  // private buildRouteAssignCertificate(): void {
  //     this.router.put(`/${RESTServerRoute.REST_CERTIFICATE_ASSIGN}`, (req: Request, res: Response, next: NextFunction) => {
  //       req.body.ID = req.params.id;
  //       void RouterUtils.handleRestServerAction(CertificatService.handleAssignCertificate.bind(this), ServerAction.CERTIFICATE_ASSIGN, req, res, next);
  //     });
  //   }
}