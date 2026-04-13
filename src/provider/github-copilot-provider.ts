import type { LanguageModelV3, ProviderV3 } from "@ai-sdk/provider";
import { NoSuchModelError } from "@ai-sdk/provider";
import type { CopilotClient } from "@github/copilot-sdk";
import { CopilotClient as CopilotClientClass } from "@github/copilot-sdk";
import { GitHubCopilotLanguageModel } from "../model/github-copilot-language-model.js";
import type { CopilotTokenManager } from "../auth/copilot-token.js";
import type { GitHubCopilotProviderOptions, GitHubCopilotSettings } from "./types.js";

export type GitHubCopilotModelId = string;

export interface GitHubCopilotProvider extends ProviderV3 {
  (modelId: GitHubCopilotModelId, settings?: GitHubCopilotSettings): LanguageModelV3;
  languageModel(modelId: GitHubCopilotModelId, settings?: GitHubCopilotSettings): LanguageModelV3;
  chat(modelId: GitHubCopilotModelId, settings?: GitHubCopilotSettings): LanguageModelV3;
  getClient(): CopilotClient;
  setTokenManager(tokenManager: CopilotTokenManager): void;
}

export function createGitHubCopilot(options: GitHubCopilotProviderOptions = {}): GitHubCopilotProvider {
  let clientInstance: CopilotClient | null = null;
  let tokenManagerInstance: CopilotTokenManager | null = null;

  const getOrCreateClient = (): CopilotClient => {
    if (!clientInstance) clientInstance = new CopilotClientClass(options.clientOptions ?? {});
    return clientInstance;
  };

  const createModel = (modelId: GitHubCopilotModelId, settings: GitHubCopilotSettings = {}): LanguageModelV3 => {
    const mergedSettings: GitHubCopilotSettings = { ...options.defaultSettings, ...settings };
    return new GitHubCopilotLanguageModel({ modelId, settings: mergedSettings, getClient: getOrCreateClient });
  };

  const provider = function(modelId: GitHubCopilotModelId, settings?: GitHubCopilotSettings) {
    if (new.target) throw new Error("The GitHub Copilot model function cannot be called with the new keyword.");
    return createModel(modelId, settings);
  };

  provider.languageModel = createModel;
  provider.chat = createModel;
  provider.specificationVersion = "v3" as const;
  provider.embeddingModel = (modelId: string) => { throw new NoSuchModelError({ modelId, modelType: "embeddingModel" }); };
  provider.imageModel = (modelId: string) => { throw new NoSuchModelError({ modelId, modelType: "imageModel" }); };
  provider.getClient = getOrCreateClient;
  provider.setTokenManager = (tm: CopilotTokenManager) => { tokenManagerInstance = tm; };

  return provider as GitHubCopilotProvider;
}

export const githubCopilot = createGitHubCopilot();
