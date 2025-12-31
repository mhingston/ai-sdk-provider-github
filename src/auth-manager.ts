import { readCliToken, saveLocalToken } from './cli-token-store';
import type {
    CachedToken,
    CopilotProviderOptions,
    CopilotTokenResponse,
    DeviceCodeResponse,
    DeviceAccessTokenResponse,
} from './types';

/** GitHub OAuth Client ID for Copilot */
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

/** Default headers for GitHub Copilot requests */
const COPILOT_HEADERS = {
    'User-Agent': 'GitHubCopilotChat/0.32.4',
    'Editor-Version': 'vscode/1.105.1',
    'Editor-Plugin-Version': 'copilot-chat/0.32.4',
    'Copilot-Integration-Id': 'vscode-chat',
};

/** Token expiration buffer (refresh 5 minutes before actual expiry) */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Normalize a domain URL to just the hostname.
 */
function normalizeDomain(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Get API URLs for a given GitHub domain.
 */
function getUrls(domain: string) {
    return {
        deviceCodeUrl: `https://${domain}/login/device/code`,
        accessTokenUrl: `https://${domain}/login/oauth/access_token`,
        copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
    };
}

/**
 * Auth Manager handles OAuth token management and Copilot API token exchange.
 * 
 * It supports:
 * - Reading existing OAuth tokens from CLI config
 * - Device flow authentication as fallback
 * - Automatic token refresh with caching
 */
export class AuthManager {
    private oauthToken: string | null = null;
    private cachedToken: CachedToken | null = null;
    private domain: string;
    private debug: boolean;

    constructor(options: CopilotProviderOptions = {}) {
        this.debug = options.debug ?? false;
        this.domain = options.enterpriseUrl
            ? normalizeDomain(options.enterpriseUrl)
            : 'github.com';

        // Use provided OAuth token or try to read from CLI config
        if (options.oauthToken) {
            this.oauthToken = options.oauthToken;
            this.log('Using provided OAuth token');
        } else {
            this.oauthToken = readCliToken(this.domain);
            if (this.oauthToken) {
                this.log('Found OAuth token in CLI config');
            } else {
                this.log('No OAuth token found in CLI config');
            }
        }
    }

    private log(message: string): void {
        if (this.debug) {
            console.log(`[CopilotAuth] ${message}`);
        }
    }

    /**
     * Check if we have a valid OAuth token (from CLI or provided).
     */
    hasOAuthToken(): boolean {
        return this.oauthToken !== null;
    }

    /**
     * Get a valid Copilot API token, refreshing if necessary.
     * 
     * @throws Error if no OAuth token is available
     */
    async getValidToken(): Promise<string> {
        // Check if we have a valid cached token
        if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
            this.log('Using cached Copilot token');
            return this.cachedToken.token;
        }

        // Need to exchange OAuth token for Copilot token
        if (!this.oauthToken) {
            throw new Error(
                'No OAuth token available. Run initiateDeviceFlow() first or provide an oauthToken in options.'
            );
        }

        this.log('Exchanging OAuth token for Copilot token...');
        const urls = getUrls(this.domain);

        const response = await fetch(urls.copilotTokenUrl, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${this.oauthToken}`,
                ...COPILOT_HEADERS,
            },
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Token exchange failed (${response.status}): ${text}`);
        }

        const data = await response.json() as CopilotTokenResponse;

        // Cache the token
        this.cachedToken = {
            token: data.token,
            expiresAt: data.expires_at * 1000, // Convert to milliseconds
        };

        this.log(`Copilot token obtained, expires at ${new Date(this.cachedToken.expiresAt).toISOString()}`);
        return this.cachedToken.token;
    }

    /**
     * Initiate the device flow authentication process.
     * 
     * @returns Object with verification URL and user code
     */
    async initiateDeviceFlow(): Promise<{
        verificationUri: string;
        userCode: string;
        pollForToken: () => Promise<boolean>;
    }> {
        const urls = getUrls(this.domain);

        this.log('Initiating device flow...');

        const response = await fetch(urls.deviceCodeUrl, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.35.0',
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: 'read:user',
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Device flow initiation failed (${response.status}): ${text}`);
        }

        const data = await response.json() as DeviceCodeResponse;

        this.log(`Device flow initiated. User code: ${data.user_code}`);

        // Return the verification info and a polling function
        return {
            verificationUri: data.verification_uri,
            userCode: data.user_code,
            pollForToken: async () => {
                return this.pollDeviceFlow(data.device_code, data.interval, urls.accessTokenUrl);
            },
        };
    }

    /**
     * Poll for device flow completion.
     */
    private async pollDeviceFlow(
        deviceCode: string,
        interval: number,
        accessTokenUrl: string
    ): Promise<boolean> {
        while (true) {
            const response = await fetch(accessTokenUrl, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'GitHubCopilotChat/0.35.0',
                },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    device_code: deviceCode,
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                }),
            });

            if (!response.ok) {
                this.log('Device flow polling failed');
                return false;
            }

            const data = await response.json() as DeviceAccessTokenResponse;

            if (data.access_token) {
                this.oauthToken = data.access_token;

                // Persist the token
                saveLocalToken(data.access_token);

                this.log('Device flow completed successfully and token saved.');
                return true;
            }

            if (data.error === 'authorization_pending') {
                // User hasn't authorized yet, keep polling
                await new Promise((resolve) => setTimeout(resolve, interval * 1000));
                continue;
            }

            if (data.error) {
                this.log(`Device flow error: ${data.error} - ${data.error_description}`);
                return false;
            }

            // Unknown state, keep polling
            await new Promise((resolve) => setTimeout(resolve, interval * 1000));
        }
    }

    /**
     * Get headers for Copilot API requests.
     */
    getCopilotHeaders(): Record<string, string> {
        return { ...COPILOT_HEADERS };
    }
}
