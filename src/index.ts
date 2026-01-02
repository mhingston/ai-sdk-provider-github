import { createOpenAICompatible, type OpenAICompatibleProvider } from '@ai-sdk/openai-compatible';
import { AuthManager } from './auth-manager';
import type { CopilotProviderOptions } from './types';

// Re-export types
export type { CopilotProviderOptions } from './types';
export { AuthManager } from './auth-manager';
export { readCliToken, getConfigPaths } from './cli-token-store';

/**
 * Create a GitHub Copilot provider with automatic authentication.
 */
export function createCopilot(options: CopilotProviderOptions = {}): OpenAICompatibleProvider {
    const authManager = new AuthManager(options);
    const debug = options.debug ?? false;

    // Determine base URL (defaulting to strict valid Copilot API domain)
    const baseURL = options.baseURL ?? (
        options.enterpriseUrl
            ? `https://copilot-api.${options.enterpriseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
            : 'https://api.githubcopilot.com'
    );

    const provider = createOpenAICompatible({
        name: 'github-copilot',
        baseURL,
        headers: options.headers,
        fetch: async (input, init) => {
            // 1. Endpoint Routing: Special handling for Codex vs others
            let url = input.toString();

            // If the request body indicates a codex model, we might need to route to /responses?
            // However, with strict AI SDK patterns, the modelID helps too. 
            // The original logic used modelId check *before* creating the model.
            // Here we are inside the fetch, so we check the body.
            let isCodex = false;
            let bodyStr = typeof init?.body === 'string' ? init.body : '';
            if (bodyStr.includes('"model":"gpt-5-codex') || bodyStr.includes('codex')) {
                isCodex = true;
            }

            // Force correct endpoints
            if (isCodex) {
                // Ensure we are hitting /responses
                if (!url.endsWith('/responses')) {
                    // Try to rewrite if it looks like a chat completion URL
                    url = url.replace(/\/chat\/completions$/, '/responses');
                }
            } else {
                // Ensure we are hitting /chat/completions (Copilot standard)
                if (url.endsWith('/responses')) {
                    url = url.replace('/responses', '/chat/completions');
                }
            }

            // 2. Patch Tool Schemas (Copilot Requirement: type: "object")
            if (bodyStr && !isCodex) { // Codex models on Copilot often don't support tools same way or expect different format
                try {
                    const json = JSON.parse(bodyStr);
                    if (json.tools && Array.isArray(json.tools)) {
                        let modified = false;
                        for (const tool of json.tools) {
                            if (tool.function && tool.function.parameters && !tool.function.parameters.type) {
                                tool.function.parameters.type = 'object';
                                modified = true;
                            }
                        }
                        if (modified) {
                            init = { ...init, body: JSON.stringify(json) };
                        }
                    }
                } catch (e) {
                    // ignore
                }
            }

            // 3. Auth Headers
            const token = await authManager.getValidToken();
            const copilotHeaders = authManager.getCopilotHeaders();

            const incomingHeaders = (init?.headers as Record<string, string>) || {};
            const cleanHeaders = Object.fromEntries(
                Object.entries(incomingHeaders).filter(([k]) => k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'api-key')
            );

            const headers: Record<string, string> = {
                ...copilotHeaders,
                ...cleanHeaders,
                Authorization: `Bearer ${token}`,
                'Openai-Intent': 'conversation-edits',
                'X-Initiator': 'agent',
            };

            // Remove API key from header if present (we use Bearer token)
            delete headers['x-api-key'];

            if (debug || process.env.DEBUG_PROVIDER) {
                console.log(`[CopilotFetch] URL: ${url}`);
                console.log(`[CopilotFetch] Token: ${token.substring(0, 10)}...`);
            }

            return fetch(url, {
                ...init,
                headers,
            } as any);
        }
    });

    return provider;
}

/**
 * Create a GitHub Copilot provider with device flow authentication.
 */
export async function createCopilotWithDeviceFlow(
    options: Omit<CopilotProviderOptions, 'oauthToken'> = {}
): Promise<{
    provider: OpenAICompatibleProvider;
    verificationUri: string;
    userCode: string;
    waitForAuth: () => Promise<boolean>;
}> {
    const authManager = new AuthManager(options);

    if (authManager.hasOAuthToken()) {
        return {
            provider: createCopilot(options),
            verificationUri: '',
            userCode: '',
            waitForAuth: async () => true,
        };
    }

    const { verificationUri, userCode, pollForToken } = await authManager.initiateDeviceFlow();

    const createProviderAfterAuth = () => createCopilot(options);

    let cachedProvider: OpenAICompatibleProvider | null = null;

    // Proxy for lazy loading
    const proxyProvider = new Proxy(function () { }, {
        apply: (_, __, args) => {
            if (!cachedProvider) cachedProvider = createProviderAfterAuth();
            return (cachedProvider as any)(...args);
        },
        get: (_, prop) => {
            if (!cachedProvider) cachedProvider = createProviderAfterAuth();
            return (cachedProvider as any)[prop];
        }
    }) as unknown as OpenAICompatibleProvider;

    return {
        provider: proxyProvider,
        verificationUri,
        userCode,
        waitForAuth: pollForToken,
    };
}

export default createCopilot;
