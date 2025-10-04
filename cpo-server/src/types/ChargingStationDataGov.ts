export default interface ChargingStationDataGov {
  id_pdc_itinerance: string;
  etat_pdc: Etatpdc;
  occupation_pdc: Etatpdc;
  horodatage: Date;
  etat_prise_type_2: EtatPrise;
  etat_prise_type_combo_ccs: EtatPrise;
  etat_prise_type_chademo: EtatPrise;
  etat_prise_type_ef: EtatPrise;
}

export interface OrganizationInfo {
  acronym: string;
  description: string;
  name: string;
  url: string;
}

export enum EtatOccupation {
  Unknown = 'inconnu',
  Occupe = 'occupe',
  Reserve = 'reserve',
  Libre = 'libre'
}

export enum Etatpdc {
  Unknown = 'inconnu',
  OnService = 'en_service',
  HorsService = 'hors_service'
}

export enum EtatPrise {
  Unknown = 'inconnu',
  Functional = 'fonctionnel',
  HorsService = 'hors_service'
}
