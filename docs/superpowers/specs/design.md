# ai-sdk-provider-github Refactor: Use Copilot SDK Directly

## Overview

Refactor `ai-sdk-provider-github` to use `@github/copilot-sdk` directly instead of the current hacky OpenAI-compatible approach with fetch interception.

**Problem:** The current implementation uses `@ai-sdk/openai-compatible` with a custom fetch interceptor to route requests, patch tool schemas, and inject auth headers. This is fragile and doesn't properly support Copilot features like tools.

**Solution:** Implement a proper AI SDK provider using `@github/copilot-sdk`'s `CopilotClient` and `CopilotSession`, with a fallback auth system for when the SDK can't authenticate.

## Architecture

### Component Map

```
src/
├── index.ts                              # Public exports
├── errors.ts                             # Error mapping (Auth, API, Abort)
├── provider/
│   ├── github-copilot-provider.ts        # ProviderV3 implementation
│   └── types.ts                          # Provider + settings types
├── model/
│   ├── github-copilot-language-model.ts  # LanguageModelV3 implementation
│   └── session-setup.ts                 # Session preparation
├── auth/
│   ├── cli-credentials.ts                # Read OAuth token from CLI config
│   ├── device-flow.ts                   # Device flow fallback
│   └── copilot-token.ts                 # OAuth → Copilot token exchange + caching
├── conversion/
│   ├── convert-to-copilot-messages.ts   # AI SDK prompt → Copilot format
│   ├── convert-ai-sdk-tools-to-copilot.ts # Tools with execute bridge
│   ├── map-copilot-finish-reason.ts     # Finish reason mapping
│   └── usage.ts                         # Usage data conversion
└── streaming/
    └── stream-event-handler.ts          # Copilot events → AI SDK stream parts
```

## Auth Fallback Flow

```
getValidToken()
├── Try @github/copilot-sdk auth (CopilotClient handles this internally)
└── If no SDK auth:
    ├── readCliToken() → from ~/.config/github-copilot/{apps.json,hosts.json}
    │   └── If found → exchange for Copilot token (copilot-token.ts)
    └── If no token → throw error (device flow removed, user must provide oauthToken)
```

**Note:** Device flow is removed. Users must either:
- Have Copilot CLI authenticated (`copilot auth`)
- Provide an `oauthToken` directly in options

## Key Design Decisions

### 1. Provider Interface

Implement `ProviderV3` with:
- `languageModel(modelId, settings?)` → `LanguageModelV3`
- `chat(modelId, settings?)` → `LanguageModelV3` (alias)
- `getClient()` → `CopilotClient` (advanced usage)
- `embeddingModel()` → throws `NoSuchModelError`
- `imageModel()` → throws `NoSuchModelError`

### 2. Language Model Implementation

`GitHubCopilotLanguageModel` implements `LanguageModelV3`:

- **`doGenerate()`**: Uses `CopilotSession.sendAndWait()` for non-streaming
- **`doStream()`**: Uses `CopilotSession.send()` with `session.on()` event handler for streaming
- Proper abort signal handling
- Session lifecycle (create → use → destroy)

### 3. Message Conversion

Convert AI SDK `LanguageModelV3Prompt` to Copilot text format:
- System messages → `System: {content}`
- User messages → `User: {content}`
- Assistant messages → `Assistant: {content}`
- Tool results → `Tool result ({name}): {output}`

### 4. Tool Support

Tools passed via AI SDK `tools` option with `providerOptions['github-copilot'].execute`:
```typescript
tool({
  description: '...',
  inputSchema: z.object({...}),
  execute: myHandler,
  providerOptions: { 'github-copilot': { execute: myHandler } },
})
```

No schema patching needed — the SDK handles tool execution natively.

### 5. Exports (Minimal)

```typescript
export { createGitHubCopilot, githubCopilot } from './provider/github-copilot-provider.js';
export type { GitHubCopilotProviderOptions, GitHubCopilotSettings } from './provider/types.js';
```

**Removed from public API:**
- `AuthManager` (internal)
- `readCliToken`, `getConfigPaths` (internal)
- Device flow helpers

## API: GitHubCopilotProviderOptions

```typescript
interface GitHubCopilotProviderOptions {
  defaultSettings?: GitHubCopilotSettings;
  clientOptions?: CopilotClientOptions; // Passed to CopilotClient
  oauthToken?: string; // GitHub OAuth token (gho_...)
}
```

## API: GitHubCopilotSettings

```typescript
interface GitHubCopilotSettings {
  model?: string;                    // Override model (e.g., "gpt-5")
  streaming?: boolean;               // Enable streaming (default true)
  systemMessage?: SystemMessageConfig;
  tools?: Tool<unknown>[];            // Copilot native tools
  provider?: ProviderConfig;         // BYOK - Bring Your Own Key
  workingDirectory?: string;
  cliPath?: string;                  // Path to Copilot CLI
  cliUrl?: string;                   // URL of existing CLI server
  sessionId?: string;                // Resume existing session
}
```

## Dependencies

```json
{
  "@ai-sdk/provider": "^3.0.0",
  "@ai-sdk/provider-utils": "^4.0.1",
  "@github/copilot-sdk": "^0.1.20"
}
```

## Breaking Changes

1. No longer exports `AuthManager`, `readCliToken`, `getConfigPaths`
2. No device flow (`createCopilotWithDeviceFlow` removed)
3. Provider function signature changed from `createCopilot()` to `createGitHubCopilot()`
4. Settings options restructured
5. No endpoint routing hacks — Copilot SDK handles model routing

## Error Handling

- `LoadAPIKeyError` → authentication failures
- `APICallError` → API errors with status codes
- AbortError passed through cleanly
- All Copilot errors mapped to appropriate AI SDK error types

## Testing Approach

- Unit tests for message conversion
- Unit tests for auth flow (mocked file system)
- Integration tests with mocked Copilot SDK
- Verify streaming and non-streaming paths work correctly
