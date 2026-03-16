'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Receipt } from '@/lib/api';
import { RiskBadge, Skeleton } from '@/components/StatusBadge';
import { useSSE } from '@/lib/useSSE';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export default function ApprovalsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${API_URL}/receipts?status=pending_approval`);
    const json = await res.json();
    setReceipts(json.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useSSE(load);

  const selected = receipts.find((r) => r.id === selectedId);

  async function handleAction(action: 'approve' | 'deny') {
    if (!selectedId) return;
    setActing(true);
    await fetch(`${API_URL}/receipts/${selectedId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: 'human-reviewer', comment }),
    });
    setActing(false);
    setSelectedId(null);
    setComment('');
    await load();
  }

  return (
    <div>
      <h1 className="text-base font-semibold text-neutral-900 mb-4">Pending Approvals</h1>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : receipts.length === 0 ? (
        <p className="text-neutral-400 text-center py-12">No pending approvals.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* List */}
          <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
            {receipts.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  i < receipts.length - 1 ? 'border-b border-neutral-150' : ''
                } ${
                  selectedId === r.id
                    ? 'bg-neutral-100 border-l-2 border-l-neutral-900'
                    : 'hover:bg-neutral-50'
                }`}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-sm font-medium text-neutral-800">
                    {r.toolName}
                  </span>
                  <RiskBadge level={r.riskLevel} />
                </div>
                {r.intent && (
                  <p className="text-sm text-neutral-500 truncate">{r.intent}</p>
                )}
              </button>
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="bg-white border border-neutral-200 rounded-md p-5">
              <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-4">
                Review Action
              </h2>

              <div className="space-y-3 mb-6">
                <DetailField label="Tool">
                  <span className="font-mono text-sm">{selected.toolName}</span>
                </DetailField>
                <DetailField label="Capability">
                  <span className="text-sm">{selected.capability}</span>
                </DetailField>
                <DetailField label="Risk">
                  <div className="flex items-center gap-2">
                    <RiskBadge level={selected.riskLevel} />
                    {selected.riskReasons.length > 0 && (
                      <span className="text-sm text-neutral-500">
                        {selected.riskReasons.join(', ')}
                      </span>
                    )}
                  </div>
                </DetailField>
                {selected.intent && (
                  <DetailField label="Intent">
                    <span className="text-sm">{selected.intent}</span>
                  </DetailField>
                )}
                <DetailField label="Policy">
                  <span className="text-sm">{selected.policyExplanation}</span>
                </DetailField>
                <div>
                  <span className="text-2xs text-neutral-400 uppercase tracking-wide font-medium">
                    Args (redacted)
                  </span>
                  <pre className="code-block mt-1 max-h-48">
                    {JSON.stringify(selected.redactedArgs, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-2xs text-neutral-400 uppercase tracking-wide font-medium mb-1">
                  Comment (optional)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full border border-neutral-200 rounded px-3 py-2 text-sm text-neutral-700 focus:ring-1 focus:ring-neutral-300 focus:border-neutral-300 focus:outline-none"
                  rows={2}
                  placeholder="Add a comment..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleAction('approve')}
                  disabled={acting}
                  className="px-4 py-1.5 bg-semantic-green text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {acting ? 'Processing...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleAction('deny')}
                  disabled={acting}
                  className="px-4 py-1.5 bg-white border border-neutral-200 text-semantic-red rounded text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                >
                  {acting ? 'Processing...' : 'Deny'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-2xs text-neutral-400 uppercase tracking-wide font-medium">{label}</span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
