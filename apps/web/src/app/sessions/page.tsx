'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge } from '@/components/StatusBadge';

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
      <h1 className="text-2xl font-bold mb-6">Sessions</h1>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-500">
          No sessions yet. Run <code className="bg-gray-100 px-1 rounded">npm run demo</code> to
          generate some.
        </p>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <div key={session.sessionId} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-mono text-sm font-medium text-gray-900">
                    {session.sessionId.slice(0, 20)}...
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Agent: {session.agentId} &middot; {new Date(session.startedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-3 text-xs">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded">
                    {session.stats.executed} executed
                  </span>
                  {session.stats.denied > 0 && (
                    <span className="bg-red-50 text-red-700 px-2 py-1 rounded">
                      {session.stats.denied} denied
                    </span>
                  )}
                  {session.stats.pending > 0 && (
                    <span className="bg-yellow-50 text-yellow-700 px-2 py-1 rounded">
                      {session.stats.pending} pending
                    </span>
                  )}
                  <span className="bg-gray-50 text-gray-600 px-2 py-1 rounded">
                    {session.stats.total} total
                  </span>
                </div>
              </div>

              {/* Timeline of actions */}
              <div className="relative ml-4 border-l-2 border-gray-200 pl-4 space-y-2">
                {session.receipts.map((r) => (
                  <Link
                    key={r.id}
                    href={`/receipt/${r.id}`}
                    className="block relative hover:bg-gray-50 rounded p-2 -ml-2 transition-colors"
                  >
                    <div
                      className="absolute -left-[1.4rem] top-3 w-2.5 h-2.5 rounded-full border-2 border-white bg-gray-300"
                      style={{
                        backgroundColor:
                          r.status === 'executed'
                            ? '#22c55e'
                            : r.status === 'denied'
                              ? '#ef4444'
                              : r.status === 'pending_approval'
                                ? '#eab308'
                                : '#9ca3af',
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{r.toolName}</span>
                      <StatusBadge status={r.status} />
                      <RiskBadge level={r.riskLevel} />
                      <span className="text-xs text-gray-400 ml-auto">
                        {new Date(r.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {r.intent && <p className="text-xs text-gray-500 mt-0.5">{r.intent}</p>}
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
