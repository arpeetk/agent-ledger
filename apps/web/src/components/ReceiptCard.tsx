'use client';

import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge } from './StatusBadge';

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  return (
    <a
      href={`/receipt/${receipt.id}`}
      className="block bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{receipt.toolName}</span>
          <StatusBadge status={receipt.status} />
          <RiskBadge level={receipt.riskLevel} />
        </div>
        <span className="text-xs text-gray-500">
          {new Date(receipt.createdAt).toLocaleString()}
        </span>
      </div>
      {receipt.intent && <p className="text-sm text-gray-600 mb-1">{receipt.intent}</p>}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Policy: {receipt.policyDecision}</span>
        <span>Capability: {receipt.capability}</span>
        {receipt.verificationStatus && <span>Verification: {receipt.verificationStatus}</span>}
      </div>
    </a>
  );
}
