import Emaid from '../Emaid';
import HttpByIDRequest from './HttpByIDRequest';
import HttpDatabaseRequest from './HttpDatabaseRequest';


export interface HttpEmaidGetRequest extends HttpByIDRequest {
ID: string;
WithUser: boolean;
}

export interface HttpEmaidDeleteRequest extends HttpByIDRequest {
ID: string;
}

export interface HttpEmaidByVisualIDGetRequest {
VisualID: string;
WithUser: boolean;
}

export interface HttpEmaidsGetRequest extends HttpDatabaseRequest {
Search: string;
UserID?: string;
Issuer?: boolean;
Active?: boolean;
WithUser: boolean;
startSession?:boolean;
}

// export interface HttpEmspRequest extends HttpDatabaseRequest {
// Issuer?: boolean;
// }

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpEmaidUpdateRequest extends Emaid {
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpEmaidCreateRequest extends Emaid {
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface HttpEmaidAssignRequest extends Emaid {
}

export interface HttpEmaidsDeleteRequest {
emaidsIDs: string[];
}

export interface HttpEmaidsByVisualIDsUnassignRequest {
visualIDs: string[];
}

export interface HttpEmaidByVisualIDUnassignRequest {
visualID: string;
}
