'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge, TableSkeleton } from '@/components/StatusBadge';
import { useSSE } from '@/lib/useSSE';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'executed', label: 'Executed' },
  { value: 'denied', label: 'Denied' },
];

const STATUS_DOT_COLOR: Record<string, string> = {
  executed: 'bg-semantic-green',
  denied: 'bg-semantic-red',
  pending_approval: 'bg-semantic-amber',
  failed: 'bg-semantic-red',
  awaiting_execution: 'bg-semantic-blue',
};

export default function TimelinePage() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter) params.set('status', filter);
    const res = await fetch(`${API_URL}/receipts?${params}`);
    const json = await res.json();
    setReceipts(json.data ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useSSE(load);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-neutral-900">Timeline</h1>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-2.5 py-1 rounded text-2xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-neutral-900 text-white'
                  : 'border border-neutral-200 text-neutral-500 hover:bg-neutral-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton />
      ) : receipts.length === 0 ? (
        <p className="text-center text-neutral-400 py-12">
          No receipts yet. Run <code className="code-block inline px-1.5 py-0.5">npm run demo</code>{' '}
          to generate some.
        </p>
      ) : (
        <div className="bg-white border border-neutral-200 rounded-md overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-150">
                <th className="text-left text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2 w-8" />
                <th className="text-left text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2">
                  Tool
                </th>
                <th className="text-left text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2">
                  Capability
                </th>
                <th className="text-left text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2">
                  Risk
                </th>
                <th className="text-left text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2">
                  Decision
                </th>
                <th className="text-right text-2xs uppercase tracking-wider text-neutral-400 font-medium px-3 py-2">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/receipt/${r.id}`)}
                  className="h-10 border-b border-neutral-100 last:border-b-0 row-hover cursor-pointer"
                >
                  <td className="px-3">
                    <span
                      className={`block w-2 h-2 rounded-full ${STATUS_DOT_COLOR[r.status] ?? 'bg-neutral-400'}`}
                    />
                  </td>
                  <td className="px-3 font-mono text-sm text-neutral-800">{r.toolName}</td>
                  <td className="px-3 text-sm text-neutral-600">{r.capability}</td>
                  <td className="px-3">
                    <RiskBadge level={r.riskLevel} />
                  </td>
                  <td className="px-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 text-right text-2xs text-neutral-400 font-mono">
                    {new Date(r.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
