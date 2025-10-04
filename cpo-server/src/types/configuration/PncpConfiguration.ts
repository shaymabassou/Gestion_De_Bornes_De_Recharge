export default interface PncpConfiguration {
    baseUrl: string; // URL de base de l'API PNCP
    apiKey: string; // Clé API pour authentification
    timeout: number; // Timeout en millisecondes
    enabled: boolean;// Activer ou désactiver PNCP
    profileId: string;
    countryCode:string;
    partyId:string;
    
}