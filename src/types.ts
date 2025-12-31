/**
 * Token data for the short-lived Copilot API token
 */
export interface TokenData {
    /** The short-lived Copilot API token (tid=...) */
    token: string;
    /** Unix timestamp in milliseconds when the token expires */
    expiresAt: number;
}

/**
 * Cached token with expiration
 */
export interface CachedToken {
    /** The Copilot API token */
    token: string;
    /** Unix timestamp in milliseconds when the token expires */
    expiresAt: number;
}

/**
 * Configuration options for the Copilot provider
 */
export interface CopilotProviderOptions {
    /**
     * OAuth token to use directly. If provided, skips CLI token lookup.
     * This should be the long-lived GitHub OAuth token (gho_...).
     */
    oauthToken?: string;

    /**
     * Base URL for the Copilot API.
     * @default "https://api.githubcopilot.com"
     */
    baseURL?: string;

    /**
     * GitHub Enterprise URL for enterprise deployments.
     * If set, uses enterprise-specific endpoints.
     */
    enterpriseUrl?: string;

    /**
     * Custom headers to include in requests.
     */
    headers?: Record<string, string>;

    /**
     * Enable debug logging.
     * @default false
     */
    debug?: boolean;
}

/**
 * GitHub CLI apps.json structure
 */
export interface GitHubAppsConfig {
    [host: string]: {
        oauth_token?: string;
        user?: string;
    };
}

/**
 * Response from Copilot token exchange endpoint
 */
export interface CopilotTokenResponse {
    token: string;
    expires_at: number;
    refresh_in?: number;
}

/**
 * Device flow authorization response
 */
export interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
}

/**
 * Device flow access token response
 */
export interface DeviceAccessTokenResponse {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
}
