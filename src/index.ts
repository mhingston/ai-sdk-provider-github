export { createGitHubCopilot, githubCopilot } from './provider/github-copilot-provider.js';
export type { GitHubCopilotProvider, GitHubCopilotModelId } from './provider/github-copilot-provider.js';
export type { GitHubCopilotProviderOptions, GitHubCopilotSettings } from './provider/types.js';
export { CopilotTokenManager } from './auth/copilot-token.js';
export { readCliToken, getConfigPaths } from './auth/cli-credentials.js';
