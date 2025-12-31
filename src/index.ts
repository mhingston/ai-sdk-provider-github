import {
    createGitHubCopilotOpenAICompatible,
    type GitHubCopilotProvider,
} from '@opeoginni/github-copilot-openai-compatible';
import { AuthManager } from './auth-manager';
import type { CopilotProviderOptions } from './types';

// Re-export types
export type { CopilotProviderOptions } from './types';
export type { GitHubCopilotModelId, GitHubCopilotProvider } from '@opeoginni/github-copilot-openai-compatible';
export { AuthManager } from './auth-manager';
export { readCliToken, getConfigPaths } from './cli-token-store';

/**
 * Input types that indicate agentic behavior (from Responses API).
 * Used to set appropriate headers for the request.
 */
const RESPONSES_API_ALTERNATE_INPUT_TYPES = [
    'file_search_call',
    'computer_call',
    'computer_call_output',
    'web_search_call',
    'function_call',
    'function_call_output',
    'image_generation_call',
    'code_interpreter_call',
    'local_shell_call',
    'local_shell_call_output',
    'mcp_list_tools',
    'mcp_approval_request',
    'mcp_approval_response',
    'mcp_call',
    'reasoning',
];

/**
 * Create a GitHub Copilot provider with automatic authentication.
 * 
 * This provider wraps @opeoginni/github-copilot-openai-compatible and handles
 * authentication automatically by:
 * 
 * 1. Looking for existing OAuth tokens in the GitHub Copilot CLI config
 * 2. Exchanging the OAuth token for a short-lived Copilot API token
 * 3. Automatically refreshing the token when it expires
 * 
 * @example
 * ```typescript
 * import { createCopilot } from 'ai-sdk-provider-github';
 * import { generateText } from 'ai';
 * 
 * const copilot = createCopilot();
 * 
 * const { text } = await generateText({
 *   model: copilot('gpt-4o'),
 *   prompt: 'Hello, world!',
 * });
 * ```
 */
export function createCopilot(options: CopilotProviderOptions = {}): GitHubCopilotProvider {
    const authManager = new AuthManager(options);
    const debug = options.debug ?? false;

    // Determine base URL
    const baseURL = options.baseURL ?? (
        options.enterpriseUrl
            ? `https://copilot-api.${options.enterpriseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
            : 'https://api.githubcopilot.com'
    );

    // Create the underlying provider with our custom fetch
    return createGitHubCopilotOpenAICompatible({
        baseURL,
        headers: options.headers,
        async fetch(input, init) {
            // Get a valid token (auto-refresh if needed)
            const token = await authManager.getValidToken();

            // Determine request characteristics for special headers
            let isAgentCall = false;
            let isVisionRequest = false;

            try {
                const body = typeof init?.body === 'string'
                    ? JSON.parse(init.body)
                    : init?.body;

                // Check for chat completions format
                if (body?.messages) {
                    isAgentCall = body.messages.some(
                        (msg: { role?: string }) => msg.role && ['tool', 'assistant'].includes(msg.role)
                    );
                    isVisionRequest = body.messages.some(
                        (msg: { content?: Array<{ type?: string }> }) =>
                            Array.isArray(msg.content) &&
                            msg.content.some((part) => part.type === 'image_url')
                    );
                }

                // Check for responses API format
                if (body?.input) {
                    const lastInput = body.input[body.input.length - 1];
                    const isAssistant = lastInput?.role === 'assistant';
                    const hasAgentType = lastInput?.type
                        ? RESPONSES_API_ALTERNATE_INPUT_TYPES.includes(lastInput.type)
                        : false;
                    isAgentCall = isAssistant || hasAgentType;

                    isVisionRequest =
                        Array.isArray(lastInput?.content) &&
                        lastInput.content.some((part: { type?: string }) => part.type === 'input_image');
                }
            } catch {
                // Ignore JSON parse errors
            }

            // Build headers
            const copilotHeaders = authManager.getCopilotHeaders();
            const headers: Record<string, string> = {
                ...copilotHeaders,
                ...(init?.headers as Record<string, string>),
                Authorization: `Bearer ${token}`,
                'Openai-Intent': 'conversation-edits',
                'X-Initiator': isAgentCall ? 'agent' : 'user',
            };

            if (isVisionRequest) {
                headers['Copilot-Vision-Request'] = 'true';
            }

            // Remove duplicate auth headers (lowercase versions)
            delete headers['x-api-key'];
            delete headers['authorization'];

            if (debug) {
                console.log(`[CopilotFetch] ${input}`);
            }

            return fetch(input, {
                ...init,
                headers,
            });
        },
    });
}

/**
 * Create a GitHub Copilot provider with device flow authentication.
 * 
 * This is useful when no CLI credentials exist and you need to authenticate
 * the user interactively.
 * 
 * @example
 * ```typescript
 * import { createCopilotWithDeviceFlow } from 'ai-sdk-provider-github';
 * 
 * const { provider, verificationUri, userCode, waitForAuth } = await createCopilotWithDeviceFlow();
 * 
 * console.log(`Please visit ${verificationUri} and enter code: ${userCode}`);
 * await waitForAuth();
 * 
 * // Now you can use the provider
 * const { text } = await generateText({
 *   model: provider('gpt-4o'),
 *   prompt: 'Hello!',
 * });
 * ```
 */
export async function createCopilotWithDeviceFlow(
    options: Omit<CopilotProviderOptions, 'oauthToken'> = {}
): Promise<{
    provider: GitHubCopilotProvider;
    verificationUri: string;
    userCode: string;
    waitForAuth: () => Promise<boolean>;
}> {
    const authManager = new AuthManager(options);

    // If we already have a token, just return the provider
    if (authManager.hasOAuthToken()) {
        return {
            provider: createCopilot(options),
            verificationUri: '',
            userCode: '',
            waitForAuth: async () => true,
        };
    }

    // Initiate device flow
    const { verificationUri, userCode, pollForToken } = await authManager.initiateDeviceFlow();

    // Create a provider that will work after auth completes
    const createProviderAfterAuth = () => {
        // The authManager now has the token, create the provider
        const baseURL = options.baseURL ?? (
            options.enterpriseUrl
                ? `https://copilot-api.${options.enterpriseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
                : 'https://api.githubcopilot.com'
        );

        return createGitHubCopilotOpenAICompatible({
            baseURL,
            headers: options.headers,
            async fetch(input, init) {
                const token = await authManager.getValidToken();
                const copilotHeaders = authManager.getCopilotHeaders();

                return fetch(input, {
                    ...init,
                    headers: {
                        ...copilotHeaders,
                        ...(init?.headers as Record<string, string>),
                        Authorization: `Bearer ${token}`,
                    },
                });
            },
        });
    };

    // Return placeholder provider and auth function
    let cachedProvider: GitHubCopilotProvider | null = null;

    return {
        provider: new Proxy({} as GitHubCopilotProvider, {
            apply: (_, __, args) => {
                if (!cachedProvider) {
                    cachedProvider = createProviderAfterAuth();
                }
                return (cachedProvider as Function)(...args);
            },
            get: (_, prop) => {
                if (!cachedProvider) {
                    cachedProvider = createProviderAfterAuth();
                }
                return (cachedProvider as any)[prop];
            },
        }),
        verificationUri,
        userCode,
        waitForAuth: pollForToken,
    };
}

// Default export for convenience
export default createCopilot;
