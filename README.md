# ai-sdk-provider-github

GitHub Copilot provider for the [Vercel AI SDK](https://sdk.vercel.ai/) with **automatic authentication**.

Uses your existing GitHub Copilot CLI credentials—no manual token management needed.

## Installation

```bash
npm install ai-sdk-provider-github ai@5
```

## Quick Start

```typescript
import { createCopilot } from 'ai-sdk-provider-github';
import { generateText } from 'ai';

const copilot = createCopilot();

const { text } = await generateText({
  model: copilot('gpt-4o'),
  prompt: 'Write a haiku about TypeScript',
});

console.log(text);
```

## How It Works

1. **Reads CLI credentials** from `~/.config/github-copilot/apps.json`
2. **Exchanges** the OAuth token for a short-lived Copilot API token
3. **Auto-refreshes** tokens before they expire (30 min lifetime)

You never manage tokens manually—just use the provider.

## Available Models

All models available through your GitHub Copilot subscription:

```typescript
copilot('gpt-4o')           // GPT-4o
copilot('gpt-4.1')          // GPT-4.1
copilot('gpt-5')            // GPT-5 (if available)
copilot('claude-3.5-sonnet') // Claude 3.5 Sonnet
copilot('claude-3.7-sonnet') // Claude 3.7 Sonnet
copilot('gemini-2.0-flash-001')
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

## Device Flow (No Existing Credentials)

If you don't have CLI credentials, use device flow authentication:

```typescript
import { createCopilotWithDeviceFlow } from 'ai-sdk-provider-github';

const { provider, verificationUri, userCode, waitForAuth } = 
  await createCopilotWithDeviceFlow();

console.log(`Visit ${verificationUri} and enter: ${userCode}`);
await waitForAuth();

// Now use the provider
const { text } = await generateText({
  model: provider('gpt-4o'),
  prompt: 'Hello!',
});
```

## Configuration Options

```typescript
createCopilot({
  // Provide OAuth token directly (skips CLI lookup)
  oauthToken: 'gho_xxxxx',
  
  // GitHub Enterprise support
  enterpriseUrl: 'https://github.mycompany.com',
  
  // Custom headers
  headers: { 'X-Custom': 'value' },
  
  // Debug logging
  debug: true,
});
```

## Prerequisites

- GitHub Copilot subscription
- Existing credentials from GitHub Copilot CLI, VS Code, or another IDE

If you don't have credentials, the [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) can authenticate you.

## License

MIT
