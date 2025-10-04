
export enum OCPITariffDimensionType {
  ENERGY = 'ENERGY',
  FLAT = 'FLAT',
  PARKING_TIME = 'PARKING_TIME',
  TIME = 'TIME'
}

export enum OCPIDayOfWeekType {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY'
}
export interface OCPIPriceOptions {
  countryID: string;
  partyID: string;
}

export interface DisplayText {
  language?: string;
  text?: string;
}
export interface OCPIPriceComponent {
  type: OCPITariffDimensionType;
  price: number;
  step_size: number;
}

export interface OCPITariffRestrictions {
  start_time?: string;
  end_time?: string;
  start_date?: string;
  end_date?: string;
  min_kwh?: number;
  max_kwh?: number;
  min_power?: number;
  max_power?: number;
  min_duration?: number;
  max_duration?: number;
  day_of_week?:OCPIDayOfWeekType[];
}

export interface OCPITariffElement {
  price_components: OCPIPriceComponent[];
  restrictions?: OCPITariffRestrictions;
}

export interface OCPITariff {
  id: string;
  currency: string;
  tariff_alt_text:DisplayText[];
  elements: OCPITariffElement[];
  last_updated: Date;
}
