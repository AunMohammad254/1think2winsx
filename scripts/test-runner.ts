import { select, input } from '@inquirer/prompts';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

async function runCommand(command: string, args: string[]): Promise<void> {
    console.clear();
    console.log(`\x1b[36m🚀 Running: ${command} ${args.join(' ')}\x1b[0m\n`);

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            cwd: path.resolve(process.cwd())
        });

        child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command exited with code ${code}`));
        });
    });
}

async function generateAITests(filePath: string) {
    console.clear();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: GEMINI_API_KEY is not set in your .env files.');
        return;
    }

    try {
        const resolvedPath = path.resolve(process.cwd(), filePath);
        const fileContent = await fs.readFile(resolvedPath, 'utf-8');
        console.log(`\x1b[36m🧠 Asking Gemini to write tests for ${filePath}...\x1b[0m\n`);

        const prompt = `You are an expert TypeScript testing engineer. Write a comprehensive Vitest unit test suite for the following code.
Rules:
1. Output ONLY the raw TypeScript code. Do not wrap it in markdown blockticks like \`\`\`ts or \`\`\`. Just raw code.
2. Use 'vitest' for imports (describe, it, expect).
3. Ensure high coverage of edge cases.

File content:
${fileContent}`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) throw new Error(`Gemini API Error: ${response.statusText}`);
        
        const data = await response.json();
        let testCode = data.candidates[0].content.parts[0].text;
        
        // Strip markdown blocks if Gemini stubbornly includes them
        if (testCode.startsWith('```ts')) testCode = testCode.replace(/^```ts\n/, '');
        if (testCode.startsWith('```typescript')) testCode = testCode.replace(/^```typescript\n/, '');
        if (testCode.startsWith('```')) testCode = testCode.replace(/^```\n/, '');
        if (testCode.endsWith('```')) testCode = testCode.replace(/```$/, '');
        if (testCode.endsWith('```\n')) testCode = testCode.replace(/```\n$/, '');

        const parsedPath = path.parse(resolvedPath);
        const testFilePath = path.join(parsedPath.dir, `${parsedPath.name}.test${parsedPath.ext}`);
        
        await fs.writeFile(testFilePath, testCode.trim());
        console.log(`\x1b[32m✅ Successfully generated tests at: ${testFilePath}\x1b[0m\n`);

        const runNow = await select({
            message: 'Would you like to run the new tests right now?',
            choices: [{ name: 'Yes', value: true }, { name: 'No', value: false }]
        });

        if (runNow) {
            await runCommand('bun', ['x', 'vitest', testFilePath]);
        }

    } catch (err: any) {
        console.error('\n❌ Failed to generate tests:', err.message);
    }
}

async function main() {
    console.clear();
    console.log('\x1b[32m✨ 1Think2Win All-in-One Test Runner ✨\x1b[0m\n');

    try {
        const action = await select({
            message: 'What would you like to test today?',
            choices: [
                {
                    name: '🧠 Auto-Generate Tests with AI',
                    value: 'ai',
                    description: 'Uses Gemini to read a file and write a full test suite for it',
                },
                {
                    name: '⚡ Run Unit Tests (Vitest Interactive TUI)',
                    value: 'unit',
                    description: 'Fast, interactive terminal UI for unit testing',
                },
                {
                    name: '💻 Run Unit Tests (Browser UI)',
                    value: 'unit_ui',
                    description: 'Opens a beautiful web interface to view your unit tests',
                },
                {
                    name: '🌐 Run End-to-End Tests (Playwright UI)',
                    value: 'e2e_ui',
                    description: 'Opens the Playwright trace viewer & UI to run browser tests',
                },
                {
                    name: '🤖 Run End-to-End Tests (Headless)',
                    value: 'e2e',
                    description: 'Runs Playwright tests quietly in the background',
                },
                {
                    name: '🎯 Test a Specific File',
                    value: 'specific',
                    description: 'Run unit tests for a specific file or folder',
                },
                {
                    name: '📊 Generate Coverage Report',
                    value: 'coverage',
                    description: 'Check what percentage of your code is tested',
                },
                {
                    name: '🚀 Run Full CI Pipeline',
                    value: 'ci',
                    description: 'Run everything, just like GitHub Actions does',
                },
                {
                    name: '❌ Exit',
                    value: 'exit',
                },
            ],
        });

        switch (action) {
            case 'ai':
                const aiFile = await input({ message: 'Enter the exact path of the file to generate tests for (e.g. src/lib/rate-limiter.ts):' });
                if (aiFile.trim()) await generateAITests(aiFile.trim());
                break;
            case 'unit':
                await runCommand('bun', ['run', 'test']);
                break;
            case 'unit_ui':
                await runCommand('bun', ['run', 'test:ui']);
                break;
            case 'e2e_ui':
                await runCommand('bun', ['x', 'playwright', 'test', '--ui']);
                break;
            case 'e2e':
                await runCommand('bun', ['run', 'test:e2e']);
                break;
            case 'coverage':
                await runCommand('bun', ['run', 'test:coverage']);
                break;
            case 'ci':
                await runCommand('bun', ['run', 'test:all']);
                break;
            case 'specific':
                const filename = await input({
                    message: 'Enter the filename or path (e.g. wallet, auth.test.ts):'
                });
                if (filename.trim()) {
                    await runCommand('bun', ['x', 'vitest', filename.trim()]);
                }
                break;
            case 'exit':
                console.log('Goodbye!');
                process.exit(0);
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('User force closed')) {
            console.log('\nExiting test runner.');
            process.exit(0);
        }
        console.error('\n❌ Error running tests:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main();
