import { readCliToken } from './cli-credentials.js';

interface CachedToken { token: string; expiresAt: number; }
interface CopilotTokenResponse { token: string; expires_at: number; }

const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.32.4',
  'Editor-Version': 'vscode/1.105.1',
  'Editor-Plugin-Version': 'copilot-chat/0.32.4',
  'Copilot-Integration-Id': 'vscode-chat',
};
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function getCopilotTokenUrl(domain: string) {
  return `https://api.${domain}/copilot_internal/v2/token`;
}

export class CopilotTokenManager {
  private cachedToken: CachedToken | null = null;
  private oauthToken: string | null = null;

  constructor(oauthToken?: string | null) {
    this.oauthToken = oauthToken ?? readCliToken();
  }

  hasToken(): boolean { return this.oauthToken !== null; }

  async getValidToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
      return this.cachedToken.token;
    }
    if (!this.oauthToken) throw new Error('No OAuth token available. Provide oauthToken in options or authenticate Copilot CLI.');
    const domain = 'github.com';
    const response = await fetch(getCopilotTokenUrl(domain), {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.oauthToken}`, ...COPILOT_HEADERS },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }
    const data = await response.json() as CopilotTokenResponse;
    this.cachedToken = { token: data.token, expiresAt: data.expires_at * 1000 };
    return this.cachedToken.token;
  }
}