import { ChargingProfile, ChargingProfileKindType, ChargingProfilePurposeType, ChargingRateUnitType, Profile, RecurrencyKindType } from '../../types/ChargingProfile';
import ChargingStation, { Voltage } from '../../types/ChargingStation';
import { DateTimeFormatOptions, ResolvedDateTimeFormatOptions } from 'intl';
import moment, { duration } from 'moment';

import { ActionsResponse } from '../../types/GlobalType';
import BackendError from '../../exception/BackendError';
import ChargingStationStorage from '../../storage/mongodb/ChargingStationStorage';
import Constants from '../../utils/Constants';
import Logging from '../../utils/Logging';
import NotificationHandler from '../../notification/NotificationHandler';
import OCPPUtils from '../../server/ocpp/utils/OCPPUtils';
import PricingDefinition from '../../types/Pricing';
import PricingStorage from '../../storage/mongodb/PricingStorage';
import { ServerAction } from '../../types/Server';
import SiteArea from '../../types/SiteArea';
import { SmartChargingSetting } from '../../types/Setting';
import Tenant from '../../types/Tenant';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'SmartChargingIntegration';

export default abstract class SmartChargingIntegration<T extends SmartChargingSetting> {
  protected readonly tenant: Tenant;
  protected readonly setting: T;
  private excludedChargingStations: string[] = [];

  protected constructor(tenant: Tenant, setting: T) {
    this.tenant = tenant;
    this.setting = setting;
  }

  public async computeAndApplyChargingProfiles(siteArea: SiteArea, retry = false): Promise<ActionsResponse> {
    const actionsResponse: ActionsResponse = {
      inSuccess: 0,
      inError: 0
    };
    // Call the charging plans
    const chargingProfiles: ChargingProfile[] = await this.buildChargingProfiles(siteArea, this.excludedChargingStations);
    if (!chargingProfiles) {
      await Logging.logInfo({
        tenantID: this.tenant.id,
        action: ServerAction.CHARGING_PROFILE_UPDATE,
        module: MODULE_NAME, method: 'computeAndApplyChargingProfiles',
        message: `No Charging Profiles have been built for Site Area '${siteArea.name}'`,
      });
      return;
    }
    // Sort charging profiles
    // Lower limits need to be set first. (When high limit is set first, it may appear that the corresponding low limit is not set yet)
    chargingProfiles.sort((a, b) => a.profile.chargingSchedule.chargingSchedulePeriod[0].limit - b.profile.chargingSchedule.chargingSchedulePeriod[0].limit);
    // Apply the charging plans
    for (const chargingProfile of chargingProfiles) {
      try {
        // Set Charging Profile
        await OCPPUtils.setAndSaveChargingProfile(this.tenant, chargingProfile);
        actionsResponse.inSuccess++;
      } catch (error) {
        // Retry setting the profile and check if succeeded
        if (await this.handleRefusedChargingProfile(this.tenant, chargingProfile, siteArea.name)) {
          actionsResponse.inSuccess++;
          continue;
        }
        actionsResponse.inError++;
        await Logging.logError({
          tenantID: this.tenant.id,
          siteID: chargingProfile.chargingStation.siteID,
          siteAreaID: chargingProfile.chargingStation.siteAreaID,
          companyID: chargingProfile.chargingStation.companyID,
          chargingStationID: chargingProfile.chargingStationID,
          action: ServerAction.CHARGING_PROFILE_UPDATE,
          module: MODULE_NAME, method: 'computeAndApplyChargingProfiles',
          message: `Setting Charging Profiles for Site Area '${siteArea.name}' failed, because of  '${chargingProfile.chargingStationID}'. It has been excluded from this smart charging run automatically`,
          detailedMessages: { error: error.stack }
        });
      }
    }
    // Log
    await Logging.logActionsResponse(this.tenant.id, ServerAction.CHECK_AND_APPLY_SMART_CHARGING,
      MODULE_NAME, 'computeAndApplyChargingProfiles', actionsResponse,
      '{{inSuccess}} charging plan(s) were successfully pushed',
      '{{inError}} charging plan(s) failed to be pushed',
      '{{inSuccess}} charging plan(s) were successfully pushed and {{inError}} failed to be pushed',
      'No charging plans have been pushed'
    );
    if (actionsResponse.inError > 0 && retry === false) {
      await this.computeAndApplyChargingProfiles(siteArea, retry = true);
    }
    return actionsResponse;
  }

  public async generateTxDefaultProfileByTarif(siteID: string,chargingStation : ChargingStation , connectorID: number):Promise<Profile> {
    const pricingDefinitions = await PricingStorage.getPricingDefinitions(this.tenant,{ siteIDs:[siteID] },{ limit:1000,skip:0 });
    const sortedPricings = this.sortPricingDefitionsByRestrection(pricingDefinitions.result);
    const chargePointID = Utils.getChargePointFromConnectorID(chargingStation,connectorID);
    return this.convertPricingDefnitionRestriction2ChargingProfle(sortedPricings,chargingStation,connectorID);
  }

  protected checkIfSiteAreaIsValid(siteArea: SiteArea): void {
    if (!siteArea.maximumPower) {
      throw new BackendError({
        action: ServerAction.SMART_CHARGING,
        module: MODULE_NAME, method: 'checkIfSiteAreaIsValid',
        message: `Maximum Power is not set in Site Area '${siteArea.name}'`
      });
    }
    if (siteArea.voltage !== Voltage.VOLTAGE_230 && siteArea.voltage !== Voltage.VOLTAGE_110) {
      throw new BackendError({
        action: ServerAction.SMART_CHARGING,
        module: MODULE_NAME, method: 'checkIfSiteAreaIsValid',
        message: `Voltage must be either 110V or 230V in Site Area '${siteArea.name}'`
      });
    }
    if (siteArea.numberOfPhases !== 1 && siteArea.numberOfPhases !== 3) {
      throw new BackendError({
        action: ServerAction.SMART_CHARGING,
        module: MODULE_NAME, method: 'checkIfSiteAreaIsValid',
        message: `Number of phases must be either 1 or 3 in Site Area '${siteArea.name}'`
      });
    }
  }

  private async handleRefusedChargingProfile(tenant: Tenant, chargingProfile: ChargingProfile, siteAreaName: string): Promise<boolean> {
    // Retry setting the cp 2 more times
    for (let i = 0; i < 2; i++) {
      try {
        // Set Charging Profile
        await OCPPUtils.setAndSaveChargingProfile(this.tenant, chargingProfile);
        return true;
      } catch (error) {
        // Log failed
        await Logging.logError({
          tenantID: this.tenant.id,
          siteID: chargingProfile.chargingStation.siteID,
          siteAreaID: chargingProfile.chargingStation.siteAreaID,
          companyID: chargingProfile.chargingStation.companyID,
          chargingStationID: chargingProfile.chargingStationID,
          action: ServerAction.CHARGING_PROFILE_UPDATE,
          module: MODULE_NAME, method: 'handleRefusedChargingProfile',
          message: 'Setting Charging Profiles failed 3 times.',
          detailedMessages: { error: error.stack }
        });
      }
    }
    // Remove Charging Station from Smart Charging
    const chargingStation = await ChargingStationStorage.getChargingStation(tenant, chargingProfile.chargingStationID);
    // Remember Charging Stations which were removed from Smart Charging
    this.excludedChargingStations.push(chargingStation.id);
    // Notify Admins
    void NotificationHandler.sendComputeAndApplyChargingProfilesFailed(tenant, chargingStation,
      {
        chargeBoxID: chargingProfile.chargingStationID,
        siteID: chargingProfile.chargingStation?.siteID,
        siteAreaID: chargingProfile.chargingStation?.siteAreaID,
        companyID: chargingProfile.chargingStation?.companyID,
        siteAreaName: siteAreaName,
        evseDashboardURL: Utils.buildEvseURL(tenant.subdomain),
        tenantPrimaryColor: this.tenant?.primaryColor
      });
    return false;
  }


  private sortPricingDefitionsByRestrection(pricing:PricingDefinition[]) {
    return pricing.sort((a, b) => {
      if (a.restrictions.timeFrom && a.restrictions.timeTo && b.restrictions.timeFrom && b.restrictions.timeTo) {
        const dateAFrom = this.convertString2TimeFromMidnight(a.restrictions.timeFrom);
        const dateBFrom = this.convertString2TimeFromMidnight(b.restrictions.timeFrom);
        const dateATo = this.convertString2TimeFromMidnight(a.restrictions.timeTo);
        const dateBTo = this.convertString2TimeFromMidnight(b.restrictions.timeTo);

        if (dateAFrom < dateBFrom) {
          return -1;
        }
        if (dateAFrom > dateBFrom) {
          return 1;
        }
        if (dateATo < dateBTo) {
          return -1;
        }
        if (dateATo > dateBTo) {
          return 1;
        }

        return 0;
      }
    });
  }

  private async convertPricingDefnitionRestriction2ChargingProfle(pricings:PricingDefinition[],chargingStation: ChargingStation, connectorID : number) {
    console.log('----------------------------------connectorID:',connectorID);
    const timezone = Utils.getTimezone(chargingStation.coordinates);
    let moment1 = moment().tz(timezone).toISOString();
    console.log(moment1)
    let newdate = new Date(moment1)
    console.log('-----------------------logging:',newdate);
    console.log()
    let thisDate = moment().utcOffset('-02:00').toDate();
    console.log('timezone:',timezone);
    console.log('-------------------------------this date:',thisDate);
    console.log('-----------------------------------chargingStation.connectors:',JSON.stringify(chargingStation.connectors));
    const connector = chargingStation.connectors.filter((connectors) =>
      connectors.connectorId === connectorID);
    console.log('-------------------------------------charging Station connetor:',connector);
    let maxamperage = 0;
    if (connectorID <= 0) {
      maxamperage = chargingStation.connectors[0].amperageLimit;
      chargingStation.connectors.map((connectorss) => {
        if (connectorss.amperageLimit < maxamperage) {
          maxamperage = connectorss.amperageLimit;
        }
      });
      console.log('------------------------------connector limit :',maxamperage);
    } else {
      maxamperage = chargingStation.connectors[connectorID - 1].amperageLimit;

    }
    const cpIDs = (await ChargingStationStorage.getChargingProfiles(this.tenant,{},Constants.DB_PARAMS_MAX_LIMIT,['profile.chargingProfileId'])).result.map((profile) => profile.profile.chargingProfileId);
    let cpid = 1 ;
    do {
      cpid = Math.floor(Math.random() * 20) + 1;
    } while (cpIDs.includes(cpid));
    console.log('----------------------------cahrging profile ids :',cpIDs);
    console.log('--------------------------------pricing definitions :',pricings.toString());
    console.log('-------------------------maxamperage:',maxamperage);
    let txDefaultChargingProfile : Profile = {
      chargingProfileId:cpid ,
      stackLevel: 3,
      chargingProfilePurpose: ChargingProfilePurposeType.TX_PROFILE,
      chargingProfileKind: ChargingProfileKindType.ABSOLUTE,
      // recurrencyKind: RecurrencyKindType.,
      chargingSchedule: {
        duration: null,
        startSchedule: thisDate,
        chargingRateUnit: ChargingRateUnitType.AMPERE,
        chargingSchedulePeriod: []
      },
    };
    console.log('--------------------txDefaultChargingProfile.chargingSchedule.startSchedule.toLocaleTimeString():',txDefaultChargingProfile.chargingSchedule.startSchedule.toDateString().substring(0,5));
    const currentTime = (thisDate.getHours() * 3600) + (thisDate.getHours() * 60) + (thisDate.getSeconds());
    console.log('-----------------------------------------current time : ',currentTime);
    const firstPricingStartTimeInSeconds = this.convertString2TimeFromMidnight(pricings[0].restrictions.timeFrom);
    if (currentTime < firstPricingStartTimeInSeconds) {
      txDefaultChargingProfile.chargingSchedule.startSchedule.setHours(Math.floor(firstPricingStartTimeInSeconds / 3600));
      txDefaultChargingProfile.chargingSchedule.startSchedule.setMinutes((firstPricingStartTimeInSeconds % 3600) / 60);
    } else {
      const newStartTimeInSeconds = currentTime + 120; // 2 minutes later
      txDefaultChargingProfile.chargingSchedule.startSchedule.setHours(Math.floor(newStartTimeInSeconds / 3600));
      txDefaultChargingProfile.chargingSchedule.startSchedule.setMinutes((newStartTimeInSeconds % 3600) / 60);
    }
    let totalperiod = 0;
    pricings.forEach((pricing) => {
      console.log('---------------tariffID:',pricing.name);
      const period = { startPeriod:0, limit:0 };
      if (pricing.dimensions.energy.price > 0.9) {
        period.limit = 0;
      } else if (pricing.dimensions.energy.price >= 0.7 && pricing.dimensions.energy.price < 0.9) {
        period.limit = 0.12 * maxamperage;
      } else if (pricing.dimensions.energy.price >= 0.6 && pricing.dimensions.energy.price < 0.7) {
        period.limit = 0.30 * maxamperage;
      } else if (pricing.dimensions.energy.price >= 0.5 && pricing.dimensions.energy.price < 0.6) {
        period.limit = 0.40 * maxamperage;
      } else if (pricing.dimensions.energy.price >= 0.4 && pricing.dimensions.energy.price < 0.5) {
        period.limit = 0.60 * maxamperage;
      } else if (pricing.dimensions.energy.price <= 0.4 && pricing.dimensions.energy.price > 0.2) {
        period.limit = 0.9 * maxamperage;
      } else if (pricing.dimensions.energy.price <= 0.2) {
        period.limit = maxamperage;
      }
      if (period.limit >= 10 && period.limit < 24) {
        period.limit = 24;
      }
      if (period.limit < 10) {
        period.limit = 0;
      }
      console.log('--------------------------------------period: ',period.startPeriod);
      const periodDuration = this.convertString2TimeFromMidnight(pricing.restrictions.timeTo) - this.convertString2TimeFromMidnight(pricing.restrictions.timeFrom);
      period.startPeriod = this.convertString2TimeFromMidnight(pricing.restrictions.timeFrom) - this.convertString2TimeFromMidnight(txDefaultChargingProfile.chargingSchedule.startSchedule.toLocaleTimeString().substring(0, 5)) ;
      const newPeriod = { startPeriod:period.startPeriod, limit:period.limit };
      if (newPeriod.startPeriod >= 0) {
        totalperiod = totalperiod + periodDuration;
        txDefaultChargingProfile.chargingSchedule.chargingSchedulePeriod.push(newPeriod);
      } else if ((this.convertString2TimeFromMidnight(pricing.restrictions.timeTo) - this.convertString2TimeFromMidnight(txDefaultChargingProfile.chargingSchedule.startSchedule.toLocaleTimeString().substring(0, 5))) > 0) {
       console.log('----------------------i here :')
        newPeriod.startPeriod = 0;
        totalperiod = totalperiod + (this.convertString2TimeFromMidnight(pricing.restrictions.timeTo) - this.convertString2TimeFromMidnight(txDefaultChargingProfile.chargingSchedule.startSchedule.toLocaleTimeString().substring(0, 5)));
        txDefaultChargingProfile.chargingSchedule.chargingSchedulePeriod.push(newPeriod);
      }
    });
    txDefaultChargingProfile.chargingSchedule.duration = totalperiod;
    return txDefaultChargingProfile;
  }

  private convertString2TimeFromMidnight(time:string) {
    const [hours, minutes] = time.split(':').map(Number);

    // Calculate the number of milliseconds from midnight to the specified time
    const secondsFromMidnight = (hours * 3600) + (minutes * 60) ;

    return secondsFromMidnight;
  }

  abstract buildChargingProfiles(siteArea: SiteArea, excludedChargingStations?: string[]): Promise<ChargingProfile[]>;

  abstract checkConnection(): Promise<void>;
}
