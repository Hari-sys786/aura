import { createInterface } from 'readline';
import { writeFileSync, existsSync, copyFileSync } from 'fs';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultVal = ''): Promise<string> {
  const suffix = defaultVal ? ` (${defaultVal})` : '';
  return new Promise(resolve => {
    rl.question(`${question}${suffix}: `, answer => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function choice(question: string, options: string[], defaultIdx = 0): Promise<string> {
  return new Promise(resolve => {
    console.log(`\n${question}`);
    options.forEach((opt, i) => {
      const marker = i === defaultIdx ? '→' : ' ';
      console.log(`  ${marker} ${i + 1}. ${opt}`);
    });
    rl.question(`Choose (1-${options.length}) [${defaultIdx + 1}]: `, answer => {
      const idx = parseInt(answer.trim()) - 1;
      resolve(options[idx >= 0 && idx < options.length ? idx : defaultIdx]);
    });
  });
}

async function main(): Promise<void> {
  console.log(`
   █████╗ ██╗   ██╗██████╗  █████╗
  ██╔══██╗██║   ██║██╔══██╗██╔══██╗
  ███████║██║   ██║██████╔╝███████║
  ██╔══██║██║   ██║██╔══██╗██╔══██║
  ██║  ██║╚██████╔╝██║  ██║██║  ██║
  ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
  Setup Wizard
  `);

  if (existsSync('.env') ) {
    const overwrite = await ask('⚠️  .env already exists. Overwrite? (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup cancelled. Edit .env manually if needed.');
      rl.close();
      return;
    }
  }

  if (existsSync('.env.example')) {
    copyFileSync('.env.example', '.env');
  }

  const env: Record<string, string> = {};

  // Step 1: AI Provider
  console.log('\n━━━ Step 1: AI Provider ━━━');
  const provider = await choice('Which AI provider?', [
    'Ollama (local, free, private)',
    'NVIDIA (free tier, fast)',
    'OpenAI (paid, GPT-4)',
    'Anthropic (paid, Claude)',
    'Groq (free tier, fast)',
    'Custom endpoint',
  ], 0);

  if (provider.includes('Ollama')) {
    env['AI_PROVIDER'] = 'ollama';
    env['AI_MODEL'] = await ask('Ollama model', 'llama3.2');
    env['AI_BASE_URL'] = await ask('Ollama URL', 'http://localhost:11434');
  } else if (provider.includes('NVIDIA')) {
    env['AI_PROVIDER'] = 'nvidia';
    env['AI_MODEL'] = await ask('Model', 'meta/llama-3.1-8b-instruct');
    env['AI_BASE_URL'] = 'https://integrate.api.nvidia.com/v1';
    env['AI_API_KEY'] = await ask('NVIDIA API key (from build.nvidia.com)');
  } else if (provider.includes('OpenAI')) {
    env['AI_PROVIDER'] = 'openai';
    env['AI_MODEL'] = await ask('Model', 'gpt-4o-mini');
    env['AI_BASE_URL'] = 'https://api.openai.com/v1';
    env['AI_API_KEY'] = await ask('OpenAI API key');
  } else if (provider.includes('Anthropic')) {
    env['AI_PROVIDER'] = 'anthropic';
    env['AI_MODEL'] = await ask('Model', 'claude-sonnet-4-20250514');
    env['AI_BASE_URL'] = 'https://api.anthropic.com/v1';
    env['AI_API_KEY'] = await ask('Anthropic API key');
  } else if (provider.includes('Groq')) {
    env['AI_PROVIDER'] = 'groq';
    env['AI_MODEL'] = await ask('Model', 'llama-3.1-70b-versatile');
    env['AI_BASE_URL'] = 'https://api.groq.com/openai/v1';
    env['AI_API_KEY'] = await ask('Groq API key');
  } else {
    env['AI_PROVIDER'] = 'custom';
    env['AI_MODEL'] = await ask('Model name');
    env['AI_BASE_URL'] = await ask('API base URL');
    env['AI_API_KEY'] = await ask('API key');
  }

  // Step 2: Telegram
  console.log('\n━━━ Step 2: Telegram Bot ━━━');
  const useTelegram = await ask('Set up Telegram bot? (Y/n)', 'Y');
  if (useTelegram.toLowerCase() !== 'n') {
    console.log('  Create a bot: Message @BotFather → /newbot → copy token');
    env['TELEGRAM_BOT_TOKEN'] = await ask('Bot token');
  }

  // Step 3: Google (Email + Calendar)
  console.log('\n━━━ Step 3: Google Integration ━━━');
  const useGoogle = await ask('Connect Gmail + Calendar? (y/N)', 'N');
  if (useGoogle.toLowerCase() === 'y') {
    console.log('  Create OAuth: console.cloud.google.com → APIs → Credentials → Desktop app');
    env['GOOGLE_CLIENT_ID'] = await ask('Client ID');
    env['GOOGLE_CLIENT_SECRET'] = await ask('Client Secret');
    console.log('  You\'ll need to complete OAuth after first start.');
  }

  // Step 4: Security
  console.log('\n━━━ Step 4: Security ━━━');
  const useMaster = await ask('Set master password for encryption? (y/N)', 'N');
  if (useMaster.toLowerCase() === 'y') {
    env['MASTER_PASSWORD'] = await ask('Master password');
  }

  // Write .env
  const envContent = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  writeFileSync('.env', envContent + '\n');

  console.log('\n✅ Setup complete! .env written.');
  console.log('Run: npm start');

  rl.close();
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
