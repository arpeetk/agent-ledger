'use client';

import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge } from './StatusBadge';

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <a
      href={`/receipt/${receipt.id}`}
      className="block bg-white border border-neutral-200 rounded-md p-4 row-hover"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-neutral-800">{receipt.toolName}</span>
          <StatusBadge status={receipt.status} />
          <RiskBadge level={receipt.riskLevel} />
        </div>
        <span className="text-2xs text-neutral-400">
          {new Date(receipt.createdAt).toLocaleString()}
        </span>
      </div>
      {receipt.intent && <p className="text-sm text-neutral-500 mb-1">{receipt.intent}</p>}
      <div className="flex items-center gap-3 text-2xs text-neutral-400">
        <span>Policy: {receipt.policyDecision}</span>
        <span>Capability: {receipt.capability}</span>
        {receipt.verificationStatus && <span>Verification: {receipt.verificationStatus}</span>}
      </div>
    </a>
  );
}
