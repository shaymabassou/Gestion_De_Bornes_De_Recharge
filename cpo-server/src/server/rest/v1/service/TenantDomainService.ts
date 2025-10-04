import FormData from 'form-data';
import AxiosFactory from '../../../../utils/AxiosFactory';
import { AxiosInstance } from 'axios';
import Tenant from '../../../../types/Tenant';
import Configuration from '../../../../utils/Configuration';

export default class TenantDomainService {
  protected axiosInstance: AxiosInstance;
  protected tenant: Tenant;
  private domainConfig = Configuration.getTenantDomainConfig();
  public constructor(tenant: Tenant) {
    this.axiosInstance = AxiosFactory.getAxiosInstance(tenant);
    this.tenant = tenant;
  }

  public async buildTenantDomain(subdomain) {
    // create form data
    const data = new FormData();
    data.append('variables[CPO_TENANT_SUBDOMAIN]', subdomain);
    // data.append('ref',ref)
    data.append('ref',this.domainConfig.ref);
    data.append('token', this.domainConfig.token);
    // send gitlab pipeline api
    const response = await this.axiosInstance.post(this.domainConfig.url, data,{
      headers: data.getHeaders(),
    });
    return response;
  }


}
