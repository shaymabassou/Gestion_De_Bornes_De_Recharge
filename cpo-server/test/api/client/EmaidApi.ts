import AuthenticatedBaseApi from './utils/AuthenticatedBaseApi';
import CrudApi from './utils/CrudApi';
import { RESTServerRoute } from '../../../src/types/Server';
import TestConstants from './utils/TestConstants';

export default class EmaidApi extends CrudApi {
 public constructor(authenticatedApi: AuthenticatedBaseApi) {
    super(authenticatedApi);
  }

  public async read(params, paging = TestConstants.DEFAULT_PAGING, ordering = TestConstants.DEFAULT_ORDERING) {
    return super.readAll(params, paging, ordering, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAIDS));
  }

  public async readEmaid(id: string) {
    return super.read({ ID: id }, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID, { id }));
  }

  public async updateEmaid(data) {
    return super.update(data, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID, { id: data.id }));
  }

  public async assignEmaid(params?) {
    return super.update(params, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID_ASSIGN, { id: params.visualID }));
  }

  public async updateEmaidByVisualID(params?) {
    return super.update(params, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID, { id: params.visualID }));
  }

  public async unassignEmaid(params?) {
    return super.update(params, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID_UNASSIGN, { id: params.visualID }));
  }

  public async readEmaidByVisualID(visualID: string) {
    return super.read({ VisualID: visualID }, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAIDS));
  }

  public async createEmaid(data) {
    return super.create(data, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAIDS));
  }

  public async deleteEmaid(id: string) {
    return super.delete(id, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAID, { id }));
  }

  public async exportEmaids(params) {
    return super.read(params, this.buildRestEndpointUrl(RESTServerRoute.REST_EMAIDS_EXPORT));
  }
}
