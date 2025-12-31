import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { GitHubAppsConfig } from './types';

/**
 * Get the GitHub Copilot config directory path based on the OS.
 */
function getConfigDir(): string {
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'win32') {
        // Windows: %APPDATA%/github-copilot
        return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'github-copilot');
    }

    // macOS and Linux: ~/.config/github-copilot
    return path.join(home, '.config', 'github-copilot');
}

/**
 * Try to read and parse a JSON file.
 */
function tryReadJson<T>(filePath: string): T | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch {
        return null;
    }
}

/**
 * Extract OAuth token from apps.json format.
 * 
 * The actual format is:
 * {
 *   "github.com:ClientId": {
 *     "user": "username",
 *     "oauth_token": "gho_xxxxx",
 *     "githubAppId": "ClientId"
 *   }
 * }
 * 
 * We prefer gho_ tokens (OAuth) over ghu_ tokens (user tokens).
 */
function extractTokenFromApps(data: Record<string, unknown>, host: string = 'github.com'): string | null {
    // Collect all tokens for the host
    const tokens: { token: string; isOAuth: boolean }[] = [];

    for (const [key, value] of Object.entries(data)) {
        // Match keys like "github.com:ClientId" or just "github.com"
        if (key === host || key.startsWith(`${host}:`)) {
            if (typeof value === 'object' && value !== null) {
                const record = value as Record<string, unknown>;
                if (typeof record.oauth_token === 'string') {
                    tokens.push({
                        token: record.oauth_token,
                        isOAuth: record.oauth_token.startsWith('gho_'),
                    });
                }
            }
        }
    }

    // Prefer gho_ tokens (OAuth tokens) over ghu_ tokens
    const oauthToken = tokens.find(t => t.isOAuth);
    if (oauthToken) {
        return oauthToken.token;
    }

    // Fall back to any token if no gho_ token found
    if (tokens.length > 0) {
        return tokens[0].token;
    }

    return null;
}

/**
 * Extract OAuth token from hosts.json format.
 * 
 * Format varies, commonly:
 * {
 *   "github.com": {
 *     "oauth_token": "gho_xxxxx"
 *   }
 * }
 * 
 * Or old format:
 * {
 *   "github.com:user": "gho_xxxxx"
 * }
 */
function extractTokenFromHosts(data: Record<string, unknown>, host: string = 'github.com'): string | null {
    // Try direct host key with oauth_token
    const hostData = data[host];
    if (typeof hostData === 'object' && hostData !== null) {
        const record = hostData as Record<string, unknown>;
        if (typeof record.oauth_token === 'string') {
            return record.oauth_token;
        }
    }

    // Try old "host:user" format
    for (const key of Object.keys(data)) {
        if (key.startsWith(`${host}:`)) {
            const value = data[key];
            if (typeof value === 'string' && (value.startsWith('gho_') || value.startsWith('ghu_'))) {
                return value;
            }
        }
    }

    return null;
}

const LOCAL_AUTH_FILE = path.join(os.homedir(), '.ai-sdk-github-auth.json');

/**
 * Save a standalone OAuth token to a local file.
 */
export function saveLocalToken(token: string): void {
    try {
        const data = { oauth_token: token, updated_at: new Date().toISOString() };
        // Save with restricted permissions (600)
        fs.writeFileSync(LOCAL_AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (e) {
        // Ignore write errors (e.g. permission issues)
    }
}

/**
 * Read OAuth token from the GitHub Copilot CLI configuration files.
 * 
 * Searches in order:
 * 1. apps.json - Main Copilot config
 * 2. hosts.json - GitHub CLI hosts config
 * 3. .ai-sdk-github-auth.json - Local auth file (Device Flow persistence)
 * 
 * @param host - The GitHub host to look up (default: "github.com")
 * @returns The OAuth token if found, null otherwise
 */
export function readCliToken(host: string = 'github.com'): string | null {
    const configDir = getConfigDir();

    // 1. Try apps.json (Official CLI)
    const appsPath = path.join(configDir, 'apps.json');
    const appsData = tryReadJson<Record<string, unknown>>(appsPath);
    if (appsData) {
        const token = extractTokenFromApps(appsData, host);
        if (token) {
            return token;
        }
    }

    // 2. Try hosts.json (Official CLI fallback)
    const hostsPath = path.join(configDir, 'hosts.json');
    const hostsData = tryReadJson<Record<string, unknown>>(hostsPath);
    if (hostsData) {
        const token = extractTokenFromHosts(hostsData, host);
        if (token) {
            return token;
        }
    }

    // 3. Try our local auth file (Device Flow persistence)
    const localData = tryReadJson<{ oauth_token: string }>(LOCAL_AUTH_FILE);
    if (localData?.oauth_token) {
        return localData.oauth_token;
    }

    return null;
}

/**
 * Get all available config file paths for debugging.
 */
export function getConfigPaths(): { appsJson: string; hostsJson: string } {
    const configDir = getConfigDir();
    return {
        appsJson: path.join(configDir, 'apps.json'),
        hostsJson: path.join(configDir, 'hosts.json'),
    };
}
