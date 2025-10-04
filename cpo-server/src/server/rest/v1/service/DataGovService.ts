import { EtatOccupation, EtatPrise, Etatpdc, OrganizationInfo } from '../../../../types/ChargingStationDataGov';
import Tenant, { TenantComponents } from '../../../../types/Tenant';
import { promises as fsPromises, readFileSync, readdirSync, statSync, unlinkSync } from 'fs';

import { ChargePointStatus } from '../../../../types/ocpp/OCPPServer';
import ChargingStationStorage from '../../../../storage/mongodb/ChargingStationStorage';
import Configuration from '../../../../utils/Configuration';
import { ConnectorType } from '../../../../types/ChargingStation';
import Constants from '../../../../utils/Constants';
import { InactivityStatus } from '../../../../types/Transaction';
import RoamingUtils from '../../../../utils/RoamingUtils';
import SettingStorage from '../../../../storage/mongodb/SettingStorage';
import TenantStorage from '../../../../storage/mongodb/TenantStorage';
import Utils from '../../../../utils/Utils';
import axios from 'axios';
import path from 'path';

export default class DataGovService {
  private static resourceId: string | null = null;

  public static mapChargePoints(chargePoints: any[]): any[] {
    return chargePoints.flatMap((chargePoint) => {
      const hasOcpiConnecterId = chargePoint.connectors.some((connector) => connector.ocpiConnecterId);

      if (!hasOcpiConnecterId) {
        return [];
      }

      let etat_pdc: string;
      if (chargePoint.inactive) {
        etat_pdc = Etatpdc.HorsService;
      } else {
        etat_pdc = Etatpdc.OnService;
      }

      let occupation_pdc: EtatOccupation;
      if (chargePoint.connectors.length === 0) {
        occupation_pdc = EtatOccupation.Unknown;
      }
      for (const connector of chargePoint.connectors) {
        if (connector.status === ChargePointStatus.OCCUPIED) {
          occupation_pdc = EtatOccupation.Occupe;
          break;
        } else if (connector.status === ChargePointStatus.RESERVED) {
          occupation_pdc = EtatOccupation.Reserve;
        } else {
          occupation_pdc = EtatOccupation.Libre;
        }
      }

      let etat_prise_type_2 = EtatPrise.Unknown;
      let etat_prise_type_combo_ccs = EtatPrise.Unknown;
      let etat_prise_type_chademo = EtatPrise.Unknown;
      const etat_prise_type_ef = EtatPrise.Unknown;
      let id_pdc_itinerance = null;
      let maxStatusLastChangedOn = null;

      for (const connector of chargePoint.connectors) {
        if (!connector.ocpiConnecterId) {
          continue;
        }

        id_pdc_itinerance = connector.ocpiConnecterId.replace(/\*/g, '');
        switch (connector.type) {
          case ConnectorType.TYPE_2:
            etat_prise_type_2 = DataGovService.getEtatChargingPoint(connector.currentInactivityStatus);
            break;
          case ConnectorType.COMBO_CCS:
            etat_prise_type_combo_ccs = DataGovService.getEtatChargingPoint(connector.currentInactivityStatus);
            break;
          case ConnectorType.CHADEMO:
            etat_prise_type_chademo = DataGovService.getEtatChargingPoint(connector.currentInactivityStatus);
            break;
        }

        // Find the maximum statusLastChangedOn date
        if (!maxStatusLastChangedOn || connector.statusLastChangedOn > maxStatusLastChangedOn) {
          maxStatusLastChangedOn = connector.statusLastChangedOn;
        }
      }

      // Format the date with timezone offset
      const offsetMinutes = new Date().getTimezoneOffset();
      const offsetHours = Math.abs(offsetMinutes / 60);
      const offsetSign = offsetMinutes > 0 ? '-' : '+';
      const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:00`;
      const horodatage = maxStatusLastChangedOn ? `${maxStatusLastChangedOn.toISOString().slice(0, -1)}${offsetString}` : '';

      return {
        id_pdc_itinerance,
        etat_pdc,
        occupation_pdc,
        horodatage,
        etat_prise_type_2,
        etat_prise_type_combo_ccs,
        etat_prise_type_chademo,
        etat_prise_type_ef
      };
    });
  }

  public static async startCrone(): Promise<void> {
    const tenants = (await TenantStorage.getTenants({}, Constants.DB_PARAMS_MAX_LIMIT)).result.filter(((tenant) => Utils.isTenantComponentActive(tenant, TenantComponents.DATAGOUV_DYNAMIC_DATA) === true));
    const mappedChargePointsArray: any[] = [];
    const rootFolder = path.resolve(global.appRoot);
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
    const filename = `consolidation-wattzhub-schema-irve-dynamic-${timestamp}.csv`;
    const destinationFolder = path.join(rootFolder, 'assets', 'data-gov', 'WattzHub');
    await fsPromises.mkdir(destinationFolder, { recursive: true });

    // Delete existing files in the directory
    const files = readdirSync(destinationFolder);
    for (const file of files) {
      unlinkSync(path.join(destinationFolder, file));
    }

    const allMappedChargePoints = [];

    for (const tenant of tenants) {
      const parentTenant = (tenant.type !== 'Child') ? tenant : await TenantStorage.getTenant(tenant.parentID);
      const ocpiSetting = await SettingStorage.getOCPISettings(parentTenant);
      const chargingStations = await ChargingStationStorage.getChargingStations(tenant, { public: true }, Constants.DB_PARAMS_MAX_LIMIT);

      chargingStations.result.forEach((chargingStation) => {
        if (ocpiSetting?.ocpi?.cpo && chargingStation.connectors.length !== 0) {
          for (let i = 0; i < chargingStation.connectors.length; i++) {
            chargingStation.connectors[i].ocpiConnecterId = RoamingUtils.buildEvseConnectorID(ocpiSetting.ocpi.cpo.countryCode, ocpiSetting.ocpi.cpo.partyID, chargingStation, chargingStation.connectors[i].connectorId);
          }
        }
      });
      allMappedChargePoints.push(...await DataGovService.mapChargePoints(chargingStations.result));
    }
    await DataGovService.convertToCSV(allMappedChargePoints, destinationFolder, filename);
    await DataGovService.uploadCSV(filename, destinationFolder);
    // return { count: mappedChargePointsArray.length, result: mappedChargePointsArray };
  }

  public static async uploadCSV(filename: string, destinationFolder: string, datasetId = '65e092e4009f18f050b14216'): Promise<boolean> {
    try {
      const dataGouvConfig = Configuration.getDataGouvConfiguration();
      const filePath = path.join(destinationFolder, filename);
      const uuid = Utils.generateUUID();
      const fileStream = readFileSync(filePath);
      const boundary = `--------------------------${Date.now().toString(16)}`;
      const fileSize = statSync(filePath).size.toString();

      // Check if resource id exists
      if (!DataGovService.resourceId) {
        const ressource = await axios.get(
          'https://www.data.gouv.fr/api/1/organizations/65e0915b7e94cb28aa703dd8/datasets/'
        );
        DataGovService.resourceId = this.findResourceWithDynamicTitle(ressource.data.data[0].resources);
      }

      // Construct the FormData payload
      const formDataPayload = `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="uuid"\r\n\r\n${uuid}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="filename"\r\n\r\n${filename}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="size"\r\n\r\n${fileSize}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n';

      const formDataEnd = `\r\n--${boundary}--\r\n`;
      const payload = Buffer.concat([
        Buffer.from(formDataPayload, 'utf-8'),
        fileStream,
        Buffer.from(formDataEnd, 'utf-8')
      ]);

      // Set the headers
      const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
        'X-API-KEY': dataGouvConfig.token,
      };

      // Make the POST request using axios
      const response = await axios.post(
        DataGovService.resourceId ?
          `https://www.data.gouv.fr/api/1/datasets/${datasetId}/resources/${DataGovService.resourceId}/upload/` :
          `https://www.data.gouv.fr/api/1/datasets/${datasetId}/upload/`,
        payload,
        { headers }
      );

      if (response.status === 200) {
        console.log('Upload du fichier CSV réussi.');
        return true;
      }
      console.error('Échec d\'Upload du fichier CSV.');
      return false;

    } catch (error) {
      console.error('Erreur lors d\'Upload du fichier CSV :', error);
      return false;
    }
  }

  private static findResourceWithDynamicTitle(resources: any[]): string | null {
    for (const resource of resources) {
      if (resource.title.includes('dynamic')) {
        return resource.id;
      }
    }
    return null;
  }

  public static async convertToCSV(data, destinationFolder: string, filename: string) {
    // Building the full path to the CSV file
    const filePath = path.join(destinationFolder, filename);

    const headers = [
      'id_pdc_itinerance',
      'etat_pdc',
      'occupation_pdc',
      'horodatage',
      'etat_prise_type_2',
      'etat_prise_type_combo_ccs',
      'etat_prise_type_chademo',
      'etat_prise_type_ef'
    ].join(',');

    const rows = data.map((item) => [
      item.id_pdc_itinerance,
      item.etat_pdc,
      item.occupation_pdc,
      item.horodatage,
      item.etat_prise_type_2,
      item.etat_prise_type_combo_ccs,
      item.etat_prise_type_chademo,
      item.etat_prise_type_ef
    ].join(',')).join('\n');

    const csvContent = headers + '\n' + rows;

    try {
      // Writing the contents of the CSV file to the
      await fsPromises.writeFile(filePath, csvContent);
      console.log(`CSV file saved successfully at: ${filePath}`);
    } catch (error) {
      console.error(`Error saving CSV file: ${error}`);
    }
  }

  private static getEtatChargingPoint(status: InactivityStatus | null): EtatPrise {
    if (status === InactivityStatus.ERROR) {
      return EtatPrise.HorsService;
    } else if (
      status === InactivityStatus.WARNING ||
      status === InactivityStatus.INFO ||
      status === null
    ) {
      return EtatPrise.Functional;
    }
    return EtatPrise.Unknown;
  }

  private static async checkOrganizationExists(tenant: Tenant, userId = '65ca15c6ccb4277a60fff3ea'): Promise<boolean> {
    try {
      const orgUrl = `https://www.data.gouv.fr/api/1/organizations/${tenant.name}`;

      const response = await axios.get<any>(orgUrl);
      const organization = response.data;

      if (!organization.members || organization.members.length === 0) {
        return false; // No members found, so the organisation probably doesn't exist
      }

      // Check whether the user with the given ID is an administrator of the organisation
      for (const member of organization.members) {
        if (member.user.id === userId && member.role === 'admin') {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private static async createOrganization(orgInfo: OrganizationInfo, logoUrl: any): Promise<string | null> {
    const dataGouvConfig = Configuration.getDataGouvConfiguration();
    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-API-KEY': dataGouvConfig.token
      };

      // POST request to create the organisation
      const createOrgResponse = await axios.post<{ id: string }>('https://www.data.gouv.fr/api/1/organizations/?lang=fr', orgInfo, { headers });

      const orgId = createOrgResponse.data.id;

      const logoResponse = await axios.get(logoUrl, { responseType: 'arraybuffer' });

      // POST request to download the organisation's logo
      const uploadImageResponse = await axios.post<{ uri: string }>(
        `https://www.data.gouv.fr/api/1/organizations/${orgId}/logo`,
        // Remplacer les données suivantes par les informations de votre image
        {
          bbox: '0,0,754.4142857142857,754.4142857142857',
          uuid: '1c63e9c8-e570-4cec-b87a-3c52b2e30859',
          filename: 'Screenshot from 2024-02-16 17-00-46.png',
          size: logoResponse.data.length, // Logo file size
          file: Buffer.from(logoResponse.data, 'binary').toString('base64') // Binary logo data converted to base64
        },
        { headers }
      );

      // Returns the URI of the downloaded logo
      return uploadImageResponse.data.uri;
    } catch (error) {
      // Managing query errors
      console.error('Error when creating the organisation:', error);
      return null;
    }
  }
}
