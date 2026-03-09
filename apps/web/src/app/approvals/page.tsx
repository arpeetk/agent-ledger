'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Receipt } from '@/lib/api';
import { RiskBadge } from '@/components/StatusBadge';
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

  // Real-time updates via SSE
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
      <h1 className="text-2xl font-bold mb-6">Pending Approvals</h1>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : receipts.length === 0 ? (
        <p className="text-gray-500">No pending approvals.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* List */}
          <div className="space-y-3">
            {receipts.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`w-full text-left bg-white border rounded-lg p-4 hover:shadow-md transition-shadow ${
                  selectedId === r.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm font-medium">{r.toolName}</span>
                  <RiskBadge level={r.riskLevel} />
                </div>
                {r.intent && <p className="text-sm text-gray-600">{r.intent}</p>}
                <p className="text-xs text-gray-500 mt-1">{r.policyExplanation}</p>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-bold mb-4">Review Action</h2>

              <div className="space-y-3 mb-6">
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">Tool</span>
                  <p className="font-mono">{selected.toolName}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">Capability</span>
                  <p>{selected.capability}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">Risk</span>
                  <div className="flex items-center gap-2">
                    <RiskBadge level={selected.riskLevel} />
                    {selected.riskReasons.length > 0 && (
                      <span className="text-sm text-gray-600">
                        {selected.riskReasons.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
                {selected.intent && (
                  <div>
                    <span className="text-xs font-medium text-gray-500 uppercase">Intent</span>
                    <p className="text-sm">{selected.intent}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">
                    Policy Explanation
                  </span>
                  <p className="text-sm">{selected.policyExplanation}</p>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase">
                    Args (redacted)
                  </span>
                  <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-auto">
                    {JSON.stringify(selected.redactedArgs, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Comment (optional)
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Add a comment..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleAction('approve')}
                  disabled={acting}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                >
                  {acting ? 'Processing...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleAction('deny')}
                  disabled={acting}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
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
