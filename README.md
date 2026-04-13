# ai-sdk-provider-github

GitHub Copilot provider for the [Vercel AI SDK](https://sdk.vercel.ai/) using the official `@github/copilot-sdk`.

## Installation

```bash
npm install ai-sdk-provider-github
```

## Quick Start

```typescript
import { createGitHubCopilot } from 'ai-sdk-provider-github';
import { generateText } from 'ai';

const copilot = createGitHubCopilot();

const { text } = await generateText({
  model: copilot('gpt-4o'),
  prompt: 'Write a haiku about TypeScript',
});

console.log(text);
```

## Authentication

The provider uses `@github/copilot-sdk` which handles authentication automatically when Copilot CLI is authenticated (`copilot auth`).

For manual token provision:

```typescript
const copilot = createGitHubCopilot({
  oauthToken: 'gho_xxxxx',  // GitHub OAuth token
});
```

## Available Models

All models available through your GitHub Copilot subscription:

```typescript
copilot('gpt-4o')             // GPT-4o
copilot('gpt-4.1')            // GPT-4.1
copilot('claude-sonnet-4-20250514') // Claude Sonnet 4
// ... and more
```

Model availability depends on your Copilot subscription tier.

## Streaming

```typescript
import { streamText } from 'ai';

const stream = streamText({
  model: copilot('gpt-4o'),
  prompt: 'Explain async/await',
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

## Tools

Tools are supported via the `providerOptions` execute bridge:

```typescript
import { tool } from 'ai';
import { z } from 'zod';

const getWeather = tool({
  description: 'Get weather for a location',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    return { weather: 'sunny', temperature: 72 };
  },
  providerOptions: {
    'github-copilot': {
      execute: async ({ location }) => {
        return { weather: 'sunny', temperature: 72 };
      },
    },
  },
});

const { text } = await generateText({
  model: copilot('gpt-4o'),
  tools: [getWeather],
  prompt: 'What is the weather in London?',
});
```

## Configuration Options

```typescript
createGitHubCopilot({
  // Default settings for all models
  defaultSettings: {
    model: 'gpt-4o',
    streaming: true,
  },

  // Copilot client options (cliPath, cliUrl, etc.)
  clientOptions: {},

  // GitHub OAuth token (skips SDK auth)
  oauthToken: 'gho_xxxxx',
});
```

### Per-model Settings

```typescript
const model = copilot('gpt-4o', {
  model: 'claude-sonnet-4-20250514',  // Override default model
  streaming: false,                      // Disable streaming
  tools: [getWeather],                   // Model-specific tools
});
```

## Prerequisites

- GitHub Copilot subscription
- GitHub Copilot CLI authenticated (`copilot auth`), OR
- Provide `oauthToken` directly

## Migration from v0.x

**Breaking changes in v1.0.0:**

- Provider renamed from `createCopilot()` to `createGitHubCopilot()`
- `createCopilotWithDeviceFlow()` removed — authenticate via `copilot auth` CLI command
- `AuthManager` no longer exported — use `CopilotTokenManager` if needed
- `readCliToken()` and `getConfigPaths()` no longer exported

**New in v1.0.0:**

- Full `@github/copilot-sdk` integration
- Native tool support via execute bridge
- Proper streaming with Copilot session events
- ProviderV3/LanguageModelV3 implementation

## License

MIT
