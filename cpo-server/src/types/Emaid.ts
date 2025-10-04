import CreatedUpdatedProps from './CreatedUpdatedProps';
import { ImportStatus } from './GlobalType';
import { OCPIToken } from './ocpi/OCPIToken';
import { EmaidAuthorizationActions } from './Authorization';
import User from './User';

export default interface Emaid extends CreatedUpdatedProps, EmaidAuthorizationActions {
id: string;
description?: string;
visualID?: string;// L'EMAID officiel (ex: DE8AC123456789)
issuer: boolean;// Indique si l'EMAID est émis par l'organisation locale
active: boolean;
userID?: string;// Lien vers l'utilisateur associé
transactionsCount?: number;
//ocpiToken?: OCPIToken;
user?: User;
email?:string;
name?: string;
firstName?: string;
//default?: boolean,
//fromEMSP?:boolean,
// importedData?: {
//     //autoActivateUserAtImport: boolean;
//     autoActivateEmaidAtImport: boolean;
// };
}

export interface ImportedEmaid {
id: string;
visualID: string;
description: string;
importedBy?: string;
importedOn?: Date;
status?: ImportStatus;
errorDescription?: string;
name?: string;
firstName?: string;
email?: string;
//fromEMSP?:boolean,
importedData?: {
    autoActivateUserAtImport: boolean;
    autoActivateEmaidAtImport: boolean;
};
siteIDs?: string;
}

export const EmaidRequiredImportProperties = [
'id'
];

