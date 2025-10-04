import { RESTServerRoute, ServerAction } from '../../../../../types/Server';
import express, { NextFunction, Request, Response } from 'express';
import RouterUtils from '../../../../../utils/RouterUtils';
import EmaidService from '../../service/EmaidService'; // À créer ou ajuster selon ton projet

export default class EmaidRouter {
private router: express.Router;

public constructor() {
    this.router = express.Router();
}

public buildRoutes(): express.Router {
    this.buildRouteEmaids();
    this.buildRouteEmaid();
    this.buildRouteCreateEmaid();
    this.buildRouteDeleteEmaid();
    this.buildRouteDeleteEmaids();
    this.buildRouteUpdateEmaid();
    this.buildRouteImportEmaid();
    this.buildRouteExportEmaid();
    this.buildRouteAssignEmaid();
    this.buildRouteUnassignEmaid();
    this.buildRouteUnassignEmaids();
    this.buildRouteProcessPDF();
    //this.buildRouteGetEmaidsEmsps();
    return this.router;
}

private buildRouteEmaids(): void {
    this.router.get(`/${RESTServerRoute.REST_EMAIDS}`, (req: Request, res: Response, next: NextFunction) => {
    if (req.query.VisualID) {
        void RouterUtils.handleRestServerAction(EmaidService.handleGetEmaidByVisualID.bind(this), ServerAction.EMAID_BY_VISUAL_ID, req, res, next);
    } else {
        void RouterUtils.handleRestServerAction(EmaidService.handleGetEmaids.bind(this), ServerAction.EMAIDS, req, res, next);
    }
    });
}

private buildRouteEmaid(): void {
    this.router.get(`/${RESTServerRoute.REST_EMAID}`, (req: Request, res: Response, next: NextFunction) => {
    req.query.ID = req.params.id;
    void RouterUtils.handleRestServerAction(EmaidService.handleGetEmaid.bind(this), ServerAction.EMAID, req, res, next);
    });
}

//   private buildRouteGetEmaidsEmsps(): void {
//     this.router.get(`/${RESTServerRoute.REST_EMAIDS_EMSP}`, (req: Request, res: Response, next: NextFunction) => {
//       void RouterUtils.handleRestServerAction(EmaidService.handleGetEmaidsEmsps.bind(this), ServerAction.EMAIDS_EMSP, req, res, next);
//     });
//   }

private buildRouteCreateEmaid(): void {
    this.router.post(`/${RESTServerRoute.REST_EMAIDS}`, (req: Request, res: Response, next: NextFunction) => {
    req.query.ID = req.params.id;
    void RouterUtils.handleRestServerAction(EmaidService.handleCreateEmaid.bind(this), ServerAction.EMAID_CREATE, req, res, next);
    });
}

private buildRouteDeleteEmaid(): void {
    this.router.delete(`/${RESTServerRoute.REST_EMAID}`, (req: Request, res: Response, next: NextFunction) => {
    req.query.ID = req.params.id;
    void RouterUtils.handleRestServerAction(EmaidService.handleDeleteEmaid.bind(this), ServerAction.EMAID_DELETE, req, res, next);
    });
}

private buildRouteDeleteEmaids(): void {
    this.router.delete(`/${RESTServerRoute.REST_EMAIDS}`, (req: Request, res: Response, next: NextFunction) => {
    void RouterUtils.handleRestServerAction(EmaidService.handleDeleteEmaids.bind(this), ServerAction.EMAIDS_DELETE, req, res, next);
    });
}

private buildRouteUpdateEmaid(): void {
    this.router.put(`/${RESTServerRoute.REST_EMAID}`, (req: Request, res: Response, next: NextFunction) => {
    if (req.body.id) {
        void RouterUtils.handleRestServerAction(EmaidService.handleUpdateEmaid.bind(this), ServerAction.EMAID_UPDATE, req, res, next);
    } else {
        void RouterUtils.handleRestServerAction(EmaidService.handleUpdateEmaidByVisualID.bind(this), ServerAction.EMAID_UPDATE, req, res, next);
    }
    });
}

private buildRouteImportEmaid(): void {
    this.router.post(`/${RESTServerRoute.REST_EMAIDS_IMPORT}`, (req: Request, res: Response, next: NextFunction) => {
    void RouterUtils.handleRestServerAction(EmaidService.handleImportEmaids.bind(this), ServerAction.EMAIDS_IMPORT, req, res, next);
    });
}

private buildRouteExportEmaid(): void {
    this.router.get(`/${RESTServerRoute.REST_EMAIDS_EXPORT}`, (req: Request, res: Response, next: NextFunction) => {
    void RouterUtils.handleRestServerAction(EmaidService.handleExportEmaids.bind(this), ServerAction.EMAIDS_EXPORT, req, res, next);
    });
}

private buildRouteAssignEmaid(): void {
    this.router.put(`/${RESTServerRoute.REST_EMAID_ASSIGN}`, (req: Request, res: Response, next: NextFunction) => {
    req.body.visualID = req.params.id;
    void RouterUtils.handleRestServerAction(EmaidService.handleAssignEmaid.bind(this), ServerAction.EMAID_ASSIGN, req, res, next);
    });
}

private buildRouteUnassignEmaid(): void {
    this.router.put(`/${RESTServerRoute.REST_EMAID_UNASSIGN}`, (req: Request, res: Response, next: NextFunction) => {
    req.body.visualID = req.params.id;
    void RouterUtils.handleRestServerAction(EmaidService.handleUnassignEmaid.bind(this), ServerAction.EMAID_UNASSIGN, req, res, next);
    });
}

private buildRouteUnassignEmaids(): void {
    this.router.put(`/${RESTServerRoute.REST_EMAIDS_UNASSIGN}`, (req: Request, res: Response, next: NextFunction) => {
    void RouterUtils.handleRestServerAction(EmaidService.handleUnassignEmaids.bind(this), ServerAction.EMAIDS_UNASSIGN, req, res, next);
    });
}

private buildRouteProcessPDF(): void {
    this.router.post(`/${RESTServerRoute.REST_EMAIDS}/process-pdf`, (req: Request, res: Response, next: NextFunction) => {
      void RouterUtils.handleRestServerAction(EmaidService.handleProcessPDF.bind(this), ServerAction.EMAID_PROCESS_PDF, req, res, next);
    });
  }

}