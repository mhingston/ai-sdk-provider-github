import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

interface GitHubAppsConfig {
  [host: string]: { oauth_token?: string; user?: string };
}

function getConfigDir(): string {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'github-copilot');
  }
  return path.join(home, '.config', 'github-copilot');
}

function tryReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch { return null; }
}

function extractTokenFromApps(data: Record<string, unknown>, host: string = 'github.com'): string | null {
  const tokens: { token: string; isOAuth: boolean }[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === host || key.startsWith(`${host}:`)) {
      if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record.oauth_token === 'string') {
          tokens.push({ token: record.oauth_token, isOAuth: record.oauth_token.startsWith('gho_') });
        }
      }
    }
  }
  const oauthToken = tokens.find(t => t.isOAuth);
  if (oauthToken) return oauthToken.token;
  if (tokens.length > 0) return tokens[0].token;
  return null;
}

function extractTokenFromHosts(data: Record<string, unknown>, host: string = 'github.com'): string | null {
  const hostData = data[host];
  if (typeof hostData === 'object' && hostData !== null) {
    const record = hostData as Record<string, unknown>;
    if (typeof record.oauth_token === 'string') return record.oauth_token;
  }
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

export function readCliToken(host: string = 'github.com'): string | null {
  const configDir = getConfigDir();
  const appsPath = path.join(configDir, 'apps.json');
  const appsData = tryReadJson<Record<string, unknown>>(appsPath);
  if (appsData) {
    const token = extractTokenFromApps(appsData, host);
    if (token) return token;
  }
  const hostsPath = path.join(configDir, 'hosts.json');
  const hostsData = tryReadJson<Record<string, unknown>>(hostsPath);
  if (hostsData) {
    const token = extractTokenFromHosts(hostsData, host);
    if (token) return token;
  }
  return null;
}

export function getConfigPaths() {
  const configDir = getConfigDir();
  return { appsJson: path.join(configDir, 'apps.json'), hostsJson: path.join(configDir, 'hosts.json') };
}