'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Receipt } from '@/lib/api';
import { Skeleton } from '@/components/StatusBadge';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

interface SessionGroup {
  sessionId: string;
  agentId: string;
  receipts: Receipt[];
  startedAt: string;
  lastAction: string;
  stats: {
    total: number;
    executed: number;
    denied: number;
    pending: number;
  };
}

const STATUS_DOT_COLOR: Record<string, string> = {
  executed: 'bg-semantic-green',
  denied: 'bg-semantic-red',
  pending_approval: 'bg-semantic-amber',
  failed: 'bg-semantic-red',
  awaiting_execution: 'bg-semantic-blue',
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API_URL}/receipts?limit=200`);
      const json = await res.json();
      const receipts: Receipt[] = json.data ?? [];

      const grouped = new Map<string, Receipt[]>();
      for (const r of receipts) {
        const existing = grouped.get(r.sessionId) ?? [];
        existing.push(r);
        grouped.set(r.sessionId, existing);
      }

      const sessionGroups: SessionGroup[] = Array.from(grouped.entries()).map(
        ([sessionId, recs]) => {
          const sorted = [...recs].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          return {
            sessionId,
            agentId: sorted[0].agentId,
            receipts: sorted,
            startedAt: sorted[0].createdAt,
            lastAction: sorted[sorted.length - 1].createdAt,
            stats: {
              total: recs.length,
              executed: recs.filter((r) => r.status === 'executed').length,
              denied: recs.filter((r) => r.status === 'denied').length,
              pending: recs.filter((r) => r.status === 'pending_approval').length,
            },
          };
        },
      );

      sessionGroups.sort(
        (a, b) => new Date(b.lastAction).getTime() - new Date(a.lastAction).getTime(),
      );
      setSessions(sessionGroups);
      setLoading(false);
    };

    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h1 className="text-base font-semibold text-neutral-900 mb-4">Sessions</h1>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-neutral-400 text-center py-12">
          No sessions yet. Run <code className="code-block inline px-1.5 py-0.5">npm run demo</code>{' '}
          to generate some.
        </p>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className="bg-white border border-neutral-200 rounded-md p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-medium text-neutral-900">{session.agentId}</h2>
                  <p className="font-mono text-2xs text-neutral-400 mt-0.5">
                    {session.sessionId.slice(0, 20)}... &middot;{' '}
                    {new Date(session.startedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-3 text-2xs">
                  <StatDot color="bg-semantic-green" label="executed" count={session.stats.executed} />
                  {session.stats.denied > 0 && (
                    <StatDot color="bg-semantic-red" label="denied" count={session.stats.denied} />
                  )}
                  {session.stats.pending > 0 && (
                    <StatDot color="bg-semantic-amber" label="pending" count={session.stats.pending} />
                  )}
                  <span className="text-neutral-400">{session.stats.total} total</span>
                </div>
              </div>

              <div className="relative ml-4 border-l border-neutral-200 pl-4 space-y-1">
                {session.receipts.map((r) => (
                  <Link
                    key={r.id}
                    href={`/receipt/${r.id}`}
                    className="block relative row-hover rounded p-1.5 -ml-1.5"
                  >
                    <div
                      className={`absolute -left-[1.15rem] top-2.5 w-2 h-2 rounded-full ${STATUS_DOT_COLOR[r.status] ?? 'bg-neutral-400'}`}
                    />
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-2xs text-neutral-700">{r.toolName}</span>
                      <span className="text-2xs text-neutral-400">
                        {r.policyDecision}
                      </span>
                      <span className="text-2xs text-neutral-400 ml-auto">
                        {new Date(r.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatDot({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-neutral-500">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      {count} {label}
    </span>
  );
}
