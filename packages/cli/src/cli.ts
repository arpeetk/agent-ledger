#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { generateKeyPair } from '@agent-ledger/core';

const BANNER = `
  ┌─────────────────────────────────────┐
  │         Agent Ledger v0.1.0         │
  │  Policy-gated AI tool execution     │
  └─────────────────────────────────────┘
`;

const HELP = `
Usage: agent-ledger [command] [options]

Commands:
  start       Start the Agent Ledger server and dashboard (default)
  server      Start the server only
  keygen      Generate a new signing key pair
  demo        Run the demo agent
  help        Show this help

Options:
  --port <n>         Server port (default: 3001)
  --web-port <n>     Dashboard port (default: 3000)
  --no-web           Don't start the web dashboard
  --policy <path>    Path to policy YAML file
  --db <path>        Path to SQLite database file
`;

interface Args {
  command: string;
  port: number;
  webPort: number;
  noWeb: boolean;
  policyPath?: string;
  dbPath?: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const result: Args = {
    command: 'start',
    port: 3001,
    webPort: 3000,
    noWeb: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === 'start' ||
      arg === 'server' ||
      arg === 'keygen' ||
      arg === 'demo' ||
      arg === 'help'
    ) {
      result.command = arg;
    } else if (arg === '--port' && args[i + 1]) {
      result.port = parseInt(args[++i], 10);
    } else if (arg === '--web-port' && args[i + 1]) {
      result.webPort = parseInt(args[++i], 10);
    } else if (arg === '--no-web') {
      result.noWeb = true;
    } else if (arg === '--policy' && args[i + 1]) {
      result.policyPath = args[++i];
    } else if (arg === '--db' && args[i + 1]) {
      result.dbPath = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      result.command = 'help';
    }
  }

  return result;
}

function log(msg: string) {
  console.log(`[agent-ledger] ${msg}`);
}

function runKeygen() {
  const kp = generateKeyPair();
  const pub = Buffer.from(kp.publicKey).toString('base64');
  const priv = Buffer.from(kp.secretKey).toString('base64');

  console.log('\nGenerated ed25519 signing key pair:\n');
  console.log(`SIGNING_PUBLIC_KEY=${pub}`);
  console.log(`SIGNING_PRIVATE_KEY=${priv}`);
  console.log(`\nPublic Key ID: ${kp.publicKeyId}`);
  console.log('\nAdd these to your .env file or environment variables.');
  console.log('The private key is 64 bytes (seed + public key concatenated).\n');
}

function findProjectRoot(): string | null {
  // Walk up from cwd looking for a package.json with "agent-ledger" workspaces
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'agent-ledger' && pkg.workspaces) {
          return dir;
        }
      } catch {
        // ignore
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.command === 'help') {
    console.log(BANNER);
    console.log(HELP);
    return;
  }

  if (args.command === 'keygen') {
    runKeygen();
    return;
  }

  console.log(BANNER);

  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    console.error(
      'Error: Could not find the agent-ledger project root.\n' +
        'Make sure you are running this from within the agent-ledger repository,\n' +
        'or install the full project: git clone <repo> && cd agent-ledger && npm install',
    );
    process.exit(1);
  }

  if (args.command === 'demo') {
    log('Running demo agent...');
    const child = spawn('npm', ['run', 'demo'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, SERVER_URL: `http://127.0.0.1:${args.port}` },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  // Start server
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(args.port),
  };

  if (args.dbPath) {
    env.DATABASE_URL = `file:${resolve(args.dbPath)}`;
  }

  log(`Starting server on port ${args.port}...`);

  const serverCmd =
    args.command === 'server' || args.noWeb ? ['run', 'dev', '-w', 'apps/server'] : ['run', 'dev'];

  const server = spawn('npm', serverCmd, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });

  server.on('exit', (code) => {
    log('Server stopped.');
    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => {
    log('Shutting down...');
    server.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    server.kill('SIGTERM');
  });

  if (!args.noWeb && args.command !== 'server') {
    log(`Dashboard: http://localhost:${args.webPort}`);
  }
  log(`Server:    http://localhost:${args.port}`);
  log('Press Ctrl+C to stop.\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
