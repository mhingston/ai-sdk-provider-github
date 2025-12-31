import { createCopilotWithDeviceFlow, createCopilot } from '../src';
import { generateText } from 'ai';

async function main() {
    // 1. Try to create a standard provider first (checks CLI & Local storage)
    try {
        const copilot = createCopilot();
        // We need to test if it actually works (token might be invalid)
        // This is a lightweight check
        await generateText({
            model: copilot('gpt-4o-mini'),
            prompt: 'hi',
        });

        console.log('✅ Found valid existing credentials.');
        await runDemo(copilot);
        return;
    } catch (e) {
        console.log('⚠️  No valid credentials found. Starting Device Flow...');
    }

    // 2. Start Device Flow
    const { provider, verificationUri, userCode, waitForAuth } = await createCopilotWithDeviceFlow();

    console.log('\n' + '═'.repeat(50));
    console.log(' 🔐 GitHub Authentication Required');
    console.log('═'.repeat(50));
    console.log(`\n1. Open: \x1b[36m${verificationUri}\x1b[0m`);
    console.log(`2. Code: \x1b[32m${userCode}\x1b[0m`);
    console.log('\nWaiting for you to authorize in the browser...');

    const success = await waitForAuth();

    if (success) {
        console.log('\n✅ Authentication successful! Token saved.');
        await runDemo(provider);
    } else {
        console.error('\n❌ Authentication failed or timed out.');
    }
}

async function runDemo(copilot: any) {
    console.log('\n🤖 Generating text...');
    const { text } = await generateText({
        model: copilot('gpt-4o'),
        prompt: 'Tell me a short joke about programming.',
    });
    console.log(`\n${text}\n`);
}

main().catch(console.error);
