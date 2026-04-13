import type { CopilotClientOptions, SessionConfig, SystemMessageConfig, Tool } from "@github/copilot-sdk";

type ProviderConfig = NonNullable<SessionConfig["provider"]>;

export interface GitHubCopilotSettings {
  model?: string;
  streaming?: boolean;
  systemMessage?: SystemMessageConfig;
  tools?: Tool<unknown>[];
  provider?: ProviderConfig;
  workingDirectory?: string;
  cliPath?: string;
  cliUrl?: string;
  sessionId?: string;
}

export interface GitHubCopilotProviderOptions {
  defaultSettings?: GitHubCopilotSettings;
  clientOptions?: CopilotClientOptions;
  oauthToken?: string;
}
