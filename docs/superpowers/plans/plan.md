# ai-sdk-provider-github Refactor Implementation Plan

> **Plan mode:** full
> **For agentic workers:**
> - **ticket-to-pr pipeline:** hand this plan to the `coordinator` agent; it
>   delegates execution to backend, frontend, and test specialists.
> - **Interactive execution:** Use `subagent-driven-development` (recommended)
>   or execute the plan inline in the current session. Steps use checkbox
>   (`- [ ]`) syntax for tracking.

**Goal:** Refactor ai-sdk-provider-github to use @github/copilot-sdk directly instead of the hacky OpenAI-compatible approach with fetch interception.

**Plan Depth Rationale:** This is a full architectural refactor with new dependencies, multiple new files, breaking API changes, and requires careful implementation of the ProviderV3/LanguageModelV3 interfaces.

## Planning Controls

| | |
|---|---|
| **Track** | Feature Track |
| **Implementation Readiness** | PASS |
| **Track Rationale** | New architecture, multiple files, breaking API changes - full plan needed |
| **Readiness Rationale** | Spec defines exact structure, files, and approach; no blockers |

**Architecture:** Use @github/copilot-sdk's CopilotClient/CopilotSession to implement proper AI SDK ProviderV3/LanguageModelV3 interfaces. Auth falls back to CLI credential reading when SDK auth unavailable. No device flow.

**Tech Stack:** TypeScript, @ai-sdk/provider, @ai-sdk/provider-utils, @github/copilot-sdk

---

## File Structure

```
src/
├── index.ts                              # Public exports (minimal)
├── errors.ts                             # Error mapping
├── provider/
│   ├── github-copilot-provider.ts        # ProviderV3 implementation
│   └── types.ts                          # Provider + settings types
├── model/
│   ├── github-copilot-language-model.ts  # LanguageModelV3 implementation
│   └── session-setup.ts                 # Session preparation
├── auth/
│   ├── cli-credentials.ts                # Read OAuth token from CLI config
│   ├── copilot-token.ts                 # OAuth → Copilot token exchange + caching
│   └── index.ts                         # Auth exports
├── conversion/
│   ├── convert-to-copilot-messages.ts   # AI SDK prompt → Copilot format
│   ├── convert-ai-sdk-tools-to-copilot.ts # Tools with execute bridge
│   ├── map-copilot-finish-reason.ts     # Finish reason mapping
│   └── usage.ts                         # Usage data conversion
└── streaming/
    └── stream-event-handler.ts          # Copilot events → AI SDK stream parts
```

---

## Task 1: Setup - Update package.json and Create Directory Structure

**Files:**
- Modify: `package.json`
- Create: `src/auth/`, `src/provider/`, `src/model/`, `src/conversion/`, `src/streaming/`

- [ ] **Step 1: Update package.json dependencies**

```json
{
  "dependencies": {
    "@ai-sdk/provider": "^3.0.0",
    "@ai-sdk/provider-utils": "^4.0.1",
    "@github/copilot-sdk": "^0.1.20"
  }
}
```

Remove: `@ai-sdk/openai-compatible`

- [ ] **Step 2: Create directory structure**

```bash
mkdir -p src/auth src/provider src/model src/conversion src/streaming
```

- [ ] **Step 3: Verify** - Run `npm install` to install new dependencies

---

## Task 2: Create errors.ts

**Files:**
- Create: `src/errors.ts`

```typescript
import { APICallError, LoadAPIKeyError } from "@ai-sdk/provider";

const AUTH_ERROR_PATTERNS = [
  "not authenticated", "authentication", "unauthorized",
  "auth failed", "please login", "login required",
  "invalid token", "token expired",
];

export function createAuthenticationError(options: { message?: string }): LoadAPIKeyError {
  return new LoadAPIKeyError({
    message: options.message ?? "Authentication failed. Please ensure Copilot CLI is properly authenticated.",
  });
}

export function createAPICallError(options: {
  message: string; statusCode?: number; cause?: unknown; isRetryable?: boolean;
}): APICallError {
  return new APICallError({
    message: options.message, url: "copilot://session", requestBodyValues: {},
    statusCode: options.statusCode, cause: options.cause, isRetryable: options.isRetryable ?? false,
  });
}

export function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

export function isAbortError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; code?: unknown };
    if (typeof e.name === "string" && e.name === "AbortError") return true;
    if (typeof e.code === "string" && e.code.toUpperCase() === "ABORT_ERR") return true;
  }
  return false;
}

export function handleCopilotError(error: unknown): never {
  if (isAbortError(error)) throw error;
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthenticationError(error)) throw createAuthenticationError({ message });
  throw createAPICallError({ message: message || "GitHub Copilot SDK error", cause: error, isRetryable: false });
}
```

---

## Task 3: Create auth/cli-credentials.ts

**Files:**
- Create: `src/auth/cli-credentials.ts`
- Reference: `cli-token-store.ts` from current implementation

- [ ] **Step 1: Create cli-credentials.ts**

```typescript
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
```

---

## Task 4: Create auth/copilot-token.ts

**Files:**
- Create: `src/auth/copilot-token.ts`

- [ ] **Step 1: Create copilot-token.ts**

```typescript
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
```

---

## Task 5: Create auth/index.ts

**Files:**
- Create: `src/auth/index.ts`

- [ ] **Step 1: Create auth/index.ts**

```typescript
export { CopilotTokenManager } from './copilot-token.js';
export { readCliToken, getConfigPaths } from './cli-credentials.js';
```

---

## Task 6: Create provider/types.ts

**Files:**
- Create: `src/provider/types.ts`

- [ ] **Step 1: Create provider/types.ts**

```typescript
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
```

---

## Task 7: Create conversion/usage.ts

**Files:**
- Create: `src/conversion/usage.ts`

- [ ] **Step 1: Create conversion/usage.ts**

```typescript
import type { LanguageModelV3Usage } from "@ai-sdk/provider";

export interface CopilotUsageEvent {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
    raw: undefined,
  };
}

export function convertCopilotUsage(event: CopilotUsageEvent): LanguageModelV3Usage {
  const inputTokens = event.inputTokens ?? 0;
  const outputTokens = event.outputTokens ?? 0;
  const cacheRead = event.cacheReadTokens ?? 0;
  const cacheWrite = event.cacheWriteTokens ?? 0;
  return {
    inputTokens: { total: inputTokens + cacheRead + cacheWrite, noCache: inputTokens, cacheRead, cacheWrite },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: undefined },
    raw: event as unknown as import("@ai-sdk/provider").JSONObject,
  };
}
```

---

## Task 8: Create conversion/map-copilot-finish-reason.ts

**Files:**
- Create: `src/conversion/map-copilot-finish-reason.ts`

- [ ] **Step 1: Create map-copilot-finish-reason.ts**

```typescript
import type { LanguageModelV3FinishReason } from "@ai-sdk/provider";

export function mapCopilotFinishReason(): LanguageModelV3FinishReason {
  return { unified: "stop", raw: undefined };
}
```

---

## Task 9: Create conversion/convert-to-copilot-messages.ts

**Files:**
- Create: `src/conversion/convert-to-copilot-messages.ts`

- [ ] **Step 1: Create convert-to-copilot-messages.ts**

```typescript
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

const IMAGE_URL_WARNING = "Image URLs are not supported by this provider; supply file paths as attachments.";
const IMAGE_BASE64_WARNING = "Base64/image data URLs require file paths. Write to temp file and pass path, or use attachments with path.";

function isImagePart(part: { type: string }): part is { type: "image" } { return part.type === "image"; }

export interface ConvertedCopilotMessage {
  prompt: string;
  systemMessage?: string;
  attachments?: Array<{ type: "file" | "directory"; path: string; displayName?: string }>;
  warnings?: string[];
}

export function convertToCopilotMessages(prompt: LanguageModelV3Prompt): ConvertedCopilotMessage {
  const messages: string[] = [];
  const warnings: string[] = [];
  let systemMessage: string | undefined;
  const attachments: Array<{ type: "file" | "directory"; path: string; displayName?: string }> = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system": {
        const content = message.content;
        systemMessage = typeof content === "string" ? content : extractTextFromParts(content);
        if (systemMessage?.trim()) messages.push(`System: ${systemMessage}`);
        break;
      }
      case "user": {
        const content = message.content;
        if (typeof content === "string") {
          messages.push(`User: ${content}`);
        } else {
          const textParts: string[] = [];
          for (const part of content) {
            if (part.type === "text") textParts.push(part.text);
            else if (part.type === "file") {
              const fileInfo = extractFileAttachment(part);
              if (fileInfo.path) attachments.push({ type: "file", path: fileInfo.path, displayName: fileInfo.displayName });
              else if (fileInfo.warning) warnings.push(fileInfo.warning);
            } else if (isImagePart(part)) warnings.push(IMAGE_BASE64_WARNING);
          }
          if (textParts.length > 0) messages.push(`User: ${textParts.join("\n")}`);
        }
        break;
      }
      case "assistant": {
        const content = message.content;
        if (typeof content === "string") {
          messages.push(`Assistant: ${content}`);
        } else {
          const textParts: string[] = [];
          for (const part of content) {
            if (part.type === "text") textParts.push(part.text);
            else if (part.type === "tool-call") textParts.push(`[Tool call: ${part.toolName}]`);
            else if (part.type === "reasoning") textParts.push(`[Reasoning: ${part.text}]`);
          }
          if (textParts.length > 0) messages.push(`Assistant: ${textParts.join("\n")}`);
        }
        break;
      }
      case "tool": {
        for (const part of message.content) {
          if (part.type === "tool-result") {
            const output = part.output;
            let resultStr: string;
            if (output.type === "text" || output.type === "error-text") resultStr = output.value;
            else if (output.type === "json" || output.type === "error-json") resultStr = JSON.stringify(output.value);
            else if (output.type === "execution-denied") resultStr = `[Execution denied${output.reason ? `: ${output.reason}` : ""}]`;
            else if (output.type === "content") resultStr = output.value.filter((p): p is { type: "text"; text: string } => p.type === "text").map(p => p.text).join("\n");
            else resultStr = "[Unknown output type]";
            const isError = output.type === "error-text" || output.type === "error-json";
            messages.push(`Tool result (${part.toolName}): ${isError ? "Error: " : ""}${resultStr}`);
          }
        }
        break;
      }
    }
  }

  return { prompt: messages.join("\n\n"), systemMessage: systemMessage?.trim() || undefined, attachments: attachments.length > 0 ? attachments : undefined, warnings: warnings.length > 0 ? warnings : undefined };
}

function extractTextFromParts(content: Array<{ type: string; text?: string }>): string {
  return content.filter((p): p is { type: "text"; text: string } => p.type === "text").map(p => p.text).join("\n");
}

function extractFileAttachment(part: { type: string; filename?: string; data?: unknown; mediaType?: string }): { path?: string; displayName?: string; warning?: string } {
  if (part.type !== "file") return {};
  const data = part.data;
  if (typeof data === "string") {
    if (data.startsWith("http://") || data.startsWith("https://")) return { warning: IMAGE_URL_WARNING };
    if (data.startsWith("file://")) return { path: data.slice(7), displayName: part.filename };
    if (data.startsWith("/") || /^[A-Za-z]:[\\/]/.test(data)) return { path: data, displayName: part.filename };
    return { warning: IMAGE_BASE64_WARNING };
  }
  return {};
}
```

---

## Task 10: Create conversion/convert-ai-sdk-tools-to-copilot.ts

**Files:**
- Create: `src/conversion/convert-ai-sdk-tools-to-copilot.ts`

- [ ] **Step 1: Create convert-ai-sdk-tools-to-copilot.ts**

```typescript
import type { LanguageModelV3FunctionTool } from "@ai-sdk/provider";
import type { Tool } from "@github/copilot-sdk";
import { defineTool } from "@github/copilot-sdk";

const PROVIDER_KEY = "github-copilot";

type CopilotProviderOptions = { execute?: (args: unknown) => unknown | Promise<unknown>; };

function hasExecute(opts: unknown): opts is CopilotProviderOptions & { execute: (args: unknown) => unknown | Promise<unknown> } {
  return opts != null && typeof opts === "object" && "execute" in opts && typeof (opts as CopilotProviderOptions).execute === "function";
}

export function convertAiSdkToolsToCopilotTools(
  tools: Array<LanguageModelV3FunctionTool | { type: string; name: string }> | undefined,
): Tool<unknown>[] {
  if (!tools?.length) return [];
  const result: Tool<unknown>[] = [];
  for (const tool of tools) {
    if (tool.type !== "function" || !("inputSchema" in tool)) continue;
    const copilotOpts = tool.providerOptions?.[PROVIDER_KEY];
    if (!hasExecute(copilotOpts)) continue;
    const execute = copilotOpts.execute;
    const copilotTool = defineTool(tool.name, {
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
      handler: async (args: unknown) => execute(args),
    });
    result.push(copilotTool);
  }
  return result;
}
```

---

## Task 11: Create conversion/index.ts

**Files:**
- Create: `src/conversion/index.ts`

- [ ] **Step 1: Create conversion/index.ts**

```typescript
export { convertToCopilotMessages } from './convert-to-copilot-messages.js';
export type { ConvertedCopilotMessage } from './convert-to-copilot-messages.js';
export { convertAiSdkToolsToCopilotTools } from './convert-ai-sdk-tools-to-copilot.js';
export { mapCopilotFinishReason } from './map-copilot-finish-reason.js';
export { convertCopilotUsage, createEmptyUsage } from './usage.js';
export type { CopilotUsageEvent } from './usage.js';
```

---

## Task 12: Create model/session-setup.ts

**Files:**
- Create: `src/model/session-setup.ts`

- [ ] **Step 1: Create model/session-setup.ts**

```typescript
import type { LanguageModelV3CallOptions, LanguageModelV3Prompt, SharedV3Warning } from "@ai-sdk/provider";
import type { CopilotClient, SystemMessageConfig } from "@github/copilot-sdk";
import { convertToCopilotMessages } from "../conversion/convert-to-copilot-messages.js";

export interface SessionSetupInput {
  prompt: LanguageModelV3Prompt;
  options: LanguageModelV3CallOptions;
  streaming: boolean;
  buildSessionConfig: (streaming: boolean, callOptions: LanguageModelV3CallOptions) => Record<string, unknown>;
  generateWarnings: (options: LanguageModelV3CallOptions) => SharedV3Warning[];
  getClient: () => CopilotClient;
  systemMessageFromSettings?: SystemMessageConfig;
}

export interface SessionSetupResult {
  prompt: string;
  attachments: Array<{ type: "file" | "directory"; path: string; displayName?: string }> | undefined;
  warnings: SharedV3Warning[];
  session: Awaited<ReturnType<CopilotClient["createSession"]>>;
}

export async function prepareSession(input: SessionSetupInput): Promise<SessionSetupResult> {
  const { prompt, options, streaming, buildSessionConfig, generateWarnings, getClient, systemMessageFromSettings } = input;
  const { prompt: promptText, systemMessage, attachments, warnings: msgWarnings } = convertToCopilotMessages(prompt);
  const warnings: SharedV3Warning[] = [...generateWarnings(options), ...(msgWarnings?.map(m => ({ type: "other" as const, message: m })) ?? [])];
  const client = getClient();
  if (client.getState() !== "connected") await client.start();
  const session = await client.createSession({
    ...buildSessionConfig(streaming, options),
    systemMessage: systemMessage ? { mode: "append", content: systemMessage } : systemMessageFromSettings,
  });
  return { prompt: promptText, attachments, warnings, session };
}
```

---

## Task 13: Create streaming/stream-event-handler.ts

**Files:**
- Create: `src/streaming/stream-event-handler.ts`

- [ ] **Step 1: Create streaming/stream-event-handler.ts**

```typescript
import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";
import type { CopilotSession, SessionEvent } from "@github/copilot-sdk";
import { mapCopilotFinishReason } from "../conversion/map-copilot-finish-reason.js";
import type { CopilotUsageEvent } from "../conversion/usage.js";
import { convertCopilotUsage, createEmptyUsage } from "../conversion/usage.js";

interface ToolState { name: string; inputStarted: boolean; callEmitted: boolean; }

export interface StreamEventHandlerParams {
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>;
  session: CopilotSession;
}

export function createStreamEventHandler(params: StreamEventHandlerParams): (event: SessionEvent) => void {
  const { controller, session } = params;
  let textPartId: string | undefined;
  let usage: LanguageModelV3Usage = createEmptyUsage();
  const toolStates = new Map<string, ToolState>();

  const finishStream = () => {
    if (textPartId) controller.enqueue({ type: "text-end", id: textPartId });
    controller.enqueue({ type: "finish", finishReason: mapCopilotFinishReason(), usage });
    controller.close();
    void session.destroy();
  };

  const handleError = (message: string) => {
    controller.enqueue({ type: "error", error: new Error(message) });
    controller.close();
    void session.destroy();
  };

  return (event: SessionEvent) => {
    switch (event.type) {
      case "assistant.message_delta": {
        const delta = event.data.deltaContent;
        if (delta) {
          if (!textPartId) { textPartId = generateId(); controller.enqueue({ type: "text-start", id: textPartId }); }
          controller.enqueue({ type: "text-delta", id: textPartId, delta });
        }
        break;
      }
      case "assistant.reasoning_delta": {
        const delta = event.data.deltaContent;
        if (delta) {
          const reasoningId = generateId();
          controller.enqueue({ type: "reasoning-start", id: reasoningId });
          controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta });
          controller.enqueue({ type: "reasoning-end", id: reasoningId });
        }
        break;
      }
      case "assistant.message": {
        const { content, toolRequests } = event.data;
        if (content && !textPartId) { textPartId = generateId(); controller.enqueue({ type: "text-start", id: textPartId }); controller.enqueue({ type: "text-delta", id: textPartId, delta: content }); controller.enqueue({ type: "text-end", id: textPartId }); }
        if (toolRequests?.length) {
          for (const tr of toolRequests) {
            const toolId = tr.toolCallId;
            let state = toolStates.get(toolId);
            if (!state) { state = { name: tr.name, inputStarted: false, callEmitted: false }; toolStates.set(toolId, state); }
            if (!state.inputStarted) { controller.enqueue({ type: "tool-input-start", id: toolId, toolName: tr.name, providerExecuted: true, dynamic: true }); state.inputStarted = true; }
            const args = tr.arguments ?? {};
            controller.enqueue({ type: "tool-input-delta", id: toolId, delta: JSON.stringify(args) });
            controller.enqueue({ type: "tool-input-end", id: toolId });
            if (!state.callEmitted) { controller.enqueue({ type: "tool-call", toolCallId: toolId, toolName: tr.name, input: typeof args === "string" ? args : JSON.stringify(args), providerExecuted: true, dynamic: true }); state.callEmitted = true; }
          }
        }
        break;
      }
      case "tool.execution_start": {
        const { toolCallId, toolName } = event.data;
        let state = toolStates.get(toolCallId);
        if (!state) { state = { name: toolName, inputStarted: true, callEmitted: false }; toolStates.set(toolCallId, state); }
        if (!state.callEmitted) {
          controller.enqueue({ type: "tool-input-start", id: toolCallId, toolName, providerExecuted: true, dynamic: true });
          controller.enqueue({ type: "tool-input-end", id: toolCallId });
          controller.enqueue({ type: "tool-call", toolCallId, toolName, input: "{}", providerExecuted: true, dynamic: true });
          state.callEmitted = true;
        }
        break;
      }
      case "tool.execution_complete": {
        const { toolCallId, success, result, error } = event.data;
        const toolNameStr = toolStates.get(toolCallId)?.name ?? "unknown";
        const resultContent = success && result?.content ? result.content : (error?.message ?? "Tool execution failed");
        controller.enqueue({ type: "tool-result", toolCallId, toolName: toolNameStr, result: resultContent as import("@ai-sdk/provider").JSONValue, isError: !success, dynamic: true });
        break;
      }
      case "assistant.usage": { usage = convertCopilotUsage(event.data as CopilotUsageEvent); break; }
      case "session.idle": finishStream(); break;
      case "session.error": handleError(event.data.message ?? "Session error"); break;
    }
  };
}
```

---

## Task 14: Create model/github-copilot-language-model.ts

**Files:**
- Create: `src/model/github-copilot-language-model.ts`

- [ ] **Step 1: Create github-copilot-language-model.ts**

```typescript
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3Content, LanguageModelV3FinishReason, LanguageModelV3StreamPart, LanguageModelV3Usage, SharedV3Warning } from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";
import type { CopilotClient } from "@github/copilot-sdk";
import { convertAiSdkToolsToCopilotTools } from "../conversion/convert-ai-sdk-tools-to-copilot.js";
import { mapCopilotFinishReason } from "../conversion/map-copilot-finish-reason.js";
import type { CopilotUsageEvent } from "../conversion/usage.js";
import { convertCopilotUsage, createEmptyUsage } from "../conversion/usage.js";
import { handleCopilotError, isAbortError } from "../errors.js";
import type { GitHubCopilotSettings } from "../provider/types.js";
import { createStreamEventHandler } from "../streaming/stream-event-handler.js";
import { prepareSession } from "./session-setup.js";

const SEND_AND_WAIT_TIMEOUT_MS = 60_000;

function addAbortListener(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export interface GitHubCopilotLanguageModelOptions {
  modelId: string;
  settings: GitHubCopilotSettings;
  getClient: () => CopilotClient;
}

export class GitHubCopilotLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly defaultObjectGenerationMode = "json" as const;
  readonly supportsImageUrls = false;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly supportsStructuredOutputs = false;
  readonly modelId: string;
  readonly settings: GitHubCopilotSettings;
  private readonly getClient: () => CopilotClient;

  constructor(options: GitHubCopilotLanguageModelOptions) {
    this.modelId = options.modelId;
    this.settings = options.settings;
    this.getClient = options.getClient;
  }

  get provider(): string { return "github-copilot"; }

  private getEffectiveModel(): string { return this.settings.model ?? this.modelId; }

  private buildSessionConfig(streaming: boolean, callOptions: LanguageModelV3CallOptions) {
    const aiSdkTools = convertAiSdkToolsToCopilotTools(callOptions.tools);
    const tools = aiSdkTools.length > 0 || this.settings.tools?.length ? [...(this.settings.tools ?? []), ...aiSdkTools] : undefined;
    return { model: this.getEffectiveModel(), sessionId: this.settings.sessionId, streaming, systemMessage: this.settings.systemMessage, tools, provider: this.settings.provider, workingDirectory: this.settings.workingDirectory };
  }

  private generateWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
    const warnings: SharedV3Warning[] = [];
    const unsupported: string[] = [];
    if (options.temperature !== undefined) unsupported.push("temperature");
    if (options.topP !== undefined) unsupported.push("topP");
    if (options.topK !== undefined) unsupported.push("topK");
    if (options.presencePenalty !== undefined) unsupported.push("presencePenalty");
    if (options.frequencyPenalty !== undefined) unsupported.push("frequencyPenalty");
    if (options.stopSequences?.length) unsupported.push("stopSequences");
    if (options.seed !== undefined) unsupported.push("seed");
    for (const param of unsupported) warnings.push({ type: "unsupported", feature: param, details: `GitHub Copilot SDK does not support the ${param} parameter. It will be ignored.` });
    return warnings;
  }

  private async prepareSessionForCall(options: LanguageModelV3CallOptions, streaming: boolean) {
    return prepareSession({ prompt: options.prompt, options, streaming, buildSessionConfig: (s, o) => this.buildSessionConfig(s, o), generateWarnings: (o) => this.generateWarnings(o), getClient: this.getClient, systemMessageFromSettings: this.settings.systemMessage });
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3["doGenerate"]>>> {
    const { prompt, attachments, warnings, session } = await this.prepareSessionForCall(options, false);
    const removeAbortListener = addAbortListener(options.abortSignal, () => session.abort());
    try {
      const result = await session.sendAndWait({ prompt, attachments }, options.abortSignal?.aborted ? 0 : SEND_AND_WAIT_TIMEOUT_MS);
      const content: LanguageModelV3Content[] = [];
      const text = result?.data?.content ?? "";
      if (text) content.push({ type: "text", text });
      let usage: LanguageModelV3Usage = createEmptyUsage();
      const usageEvent = (result as { data?: { usage?: unknown } })?.data?.usage;
      if (usageEvent && typeof usageEvent === "object") usage = convertCopilotUsage(usageEvent as CopilotUsageEvent);
      const finishReason: LanguageModelV3FinishReason = mapCopilotFinishReason();
      return { content, finishReason, usage, warnings, request: { body: { prompt, attachments } }, response: { id: generateId(), timestamp: new Date(), modelId: this.modelId } };
    } catch (error: unknown) {
      if (isAbortError(error)) throw options.abortSignal?.aborted ? options.abortSignal.reason : error;
      handleCopilotError(error);
      throw new Error("Unreachable: handleCopilotError always throws");
    } finally {
      removeAbortListener();
      try { await session.destroy(); } catch { /* Ignore destroy errors */ }
    }
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<Awaited<ReturnType<LanguageModelV3["doStream"]>>> {
    const { prompt, attachments, warnings, session } = await this.prepareSessionForCall(options, true);
    const abortController = new AbortController();
    if (options.abortSignal?.aborted) abortController.abort(options.abortSignal.reason);
    const removeAbortListener = addAbortListener(options.abortSignal, () => { session.abort(); abortController.abort(options.abortSignal?.reason); });
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        try {
          controller.enqueue({ type: "stream-start", warnings });
          const handleEvent = createStreamEventHandler({ controller, session });
          session.on(handleEvent);
          await session.send({ prompt, attachments });
        } catch (error: unknown) {
          if (isAbortError(error)) controller.enqueue({ type: "error", error: options.abortSignal?.aborted ? options.abortSignal.reason : error });
          else handleCopilotError(error);
          controller.close();
          await session.destroy();
        } finally { removeAbortListener(); }
      },
      cancel: () => { removeAbortListener(); },
    });
    return { stream: stream as ReadableStream<LanguageModelV3StreamPart>, request: { body: { prompt, attachments } } };
  }
}
```

---

## Task 15: Create provider/github-copilot-provider.ts

**Files:**
- Create: `src/provider/github-copilot-provider.ts`

- [ ] **Step 1: Create github-copilot-provider.ts**

```typescript
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
```

---

## Task 16: Create streaming/index.ts

**Files:**
- Create: `src/streaming/index.ts`

- [ ] **Step 1: Create streaming/index.ts**

```typescript
export { createStreamEventHandler } from './stream-event-handler.js';
export type { StreamEventHandlerParams } from './stream-event-handler.js';
```

---

## Task 17: Create index.ts (main exports)

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create src/index.ts**

```typescript
export { createGitHubCopilot, githubCopilot } from './provider/github-copilot-provider.js';
export type { GitHubCopilotProvider, GitHubCopilotModelId } from './provider/github-copilot-provider.js';
export type { GitHubCopilotProviderOptions, GitHubCopilotSettings } from './provider/types.js';
export { CopilotTokenManager } from './auth/copilot-token.js';
export { readCliToken, getConfigPaths } from './auth/cli-credentials.js';
```

---

## Task 18: Update tsup config if needed

**Files:**
- Modify: `tsup.config.ts` (if exists)

Check if tsup config exists and update if needed to handle the new structure. The existing config may work as-is.

- [ ] **Step 1: Check and update tsup.config.ts if needed**

Run `npm run build` to verify the build works.

---

## Task 19: Verify build

**Files:**
- Run: `npm run build`

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: Clean build with no errors

---

## Task 20: Write unit tests

**Files:**
- Create: `tests/` directory with test files

- [ ] **Step 1: Create conversion tests**

```typescript
// tests/conversion/convert-to-copilot-messages.test.ts
import { describe, it, expect } from 'vitest';
import { convertToCopilotMessages } from '../../src/conversion/convert-to-copilot-messages.js';

describe('convertToCopilotMessages', () => {
  it('should convert simple user message', () => {
    const result = convertToCopilotMessages([{ role: 'user', content: 'Hello' }]);
    expect(result.prompt).toBe('User: Hello');
  });

  it('should convert system message', () => {
    const result = convertToCopilotMessages([{ role: 'system', content: 'You are helpful' }]);
    expect(result.prompt).toBe('System: You are helpful');
    expect(result.systemMessage).toBe('You are helpful');
  });

  // ... more tests
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

---

## Final Plan Conformance Check

- [ ] All planned files were created
- [ ] All planned files compile without errors
- [ ] Build succeeds
- [ ] Unit tests pass
- [ ] No export of AuthManager (removed from public API)
- [ ] Device flow removed (no createCopilotWithDeviceFlow)
- [ ] Provider uses createGitHubCopilot naming
