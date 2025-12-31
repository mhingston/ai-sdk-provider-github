/**
 * E2E Demo: GitHub Copilot Provider
 * 
 * This demo shows how to use the GitHub Copilot provider with automatic
 * authentication. It reads your Copilot credentials from the CLI config.
 */

import { createCopilot, getConfigPaths, readCliToken } from '../src';
import { generateText, streamText } from 'ai';

async function main() {
    console.log('🚀 GitHub Copilot Provider Demo\n');

    // Check for existing credentials
    const configPaths = getConfigPaths();
    console.log('📁 Looking for credentials in:');
    console.log(`   - ${configPaths.appsJson}`);
    console.log(`   - ${configPaths.hostsJson}\n`);

    const existingToken = readCliToken();
    if (existingToken) {
        console.log(`✅ Found existing OAuth token: ${existingToken.substring(0, 10)}...`);
    } else {
        console.log('❌ No existing token found. Device flow would be needed.\n');
        console.log('To get credentials, run GitHub Copilot CLI and authenticate first.\n');
        process.exit(1);
    }

    // Create the provider (automatically handles token exchange)
    console.log('\n🔧 Creating Copilot provider...');
    const copilot = createCopilot({ debug: true });

    // Test 1: Simple text generation
    console.log('\n📝 Test 1: Simple text generation with gpt-4o\n');
    console.log('─'.repeat(60));

    try {
        const { text, usage } = await generateText({
            model: copilot('gpt-4o'),
            prompt: 'Write a haiku about TypeScript.',
        });

        console.log('\nResponse:');
        console.log(text);
        console.log(`\nTokens: ${usage?.promptTokens ?? '?'} prompt, ${usage?.completionTokens ?? '?'} completion`);
    } catch (error) {
        console.error('Error:', error);
    }

    // Test 2: Streaming
    console.log('\n📝 Test 2: Streaming with gpt-4o\n');
    console.log('─'.repeat(60));

    try {
        const stream = streamText({
            model: copilot('gpt-4o'),
            prompt: 'Count from 1 to 5, explaining each number briefly.',
        });

        process.stdout.write('\nStreaming: ');
        for await (const chunk of stream.textStream) {
            process.stdout.write(chunk);
        }
        console.log('\n');

        const finalResult = await stream;
        console.log(`Tokens: ${finalResult.usage?.promptTokens ?? '?'} prompt, ${finalResult.usage?.completionTokens ?? '?'} completion`);
    } catch (error) {
        console.error('Error:', error);
    }

    // Test 3: Claude model via Copilot
    console.log('\n📝 Test 3: Claude 3.5 Sonnet via Copilot\n');
    console.log('─'.repeat(60));

    try {
        const { text } = await generateText({
            model: copilot('claude-3.5-sonnet'),
            prompt: 'What makes TypeScript great for large codebases? Answer in 2 sentences.',
        });

        console.log('\nResponse:');
        console.log(text);
    } catch (error) {
        console.error('Error:', error);
    }

    console.log('\n✅ Demo complete!\n');
}

main().catch(console.error);
