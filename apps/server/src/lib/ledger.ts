import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActionReceipt } from '@agent-ledger/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(__dirname, '../../receipts/ledger.jsonl');

// Ensure directory exists
mkdirSync(dirname(LEDGER_PATH), { recursive: true });

export function appendToLedger(receipt: ActionReceipt): void {
  appendFileSync(LEDGER_PATH, JSON.stringify(receipt) + '\n');
}
