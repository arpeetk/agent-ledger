import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyEngine } from '@agent-ledger/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '../../../../policies/default.yaml');

let _engine: PolicyEngine | null = null;

export function getPolicyEngine(): PolicyEngine {
  if (_engine) return _engine;
  const content = readFileSync(POLICY_PATH, 'utf-8');
  _engine = new PolicyEngine(content);
  return _engine;
}
