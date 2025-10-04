import AuthenticatedBaseApi from './utils/AuthenticatedBaseApi';
import CrudApi from './utils/CrudApi';
import { RESTServerRoute } from '../../../src/types/Server';
import TestConstants from './utils/TestConstants';

export default class CertificateApi extends CrudApi {
 public constructor(authenticatedApi: AuthenticatedBaseApi) {
    super(authenticatedApi);
  }

  public async read(params, paging = TestConstants.DEFAULT_PAGING, ordering = TestConstants.DEFAULT_ORDERING) {
    return super.readAll(params, paging, ordering, this.buildRestEndpointUrl(RESTServerRoute.REST_CERTIFICATES));
  }

  public async readCertificate(id: string) {
    return super.read({ ID: id }, this.buildRestEndpointUrl(RESTServerRoute.REST_CERTIFICATE, { id }));
  }

  public async deleteCertificate(id: string) {
    return super.delete({ ID: id }, this.buildRestEndpointUrl(RESTServerRoute.REST_CERTIFICATE, { id }));
  }


}
