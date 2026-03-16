'use client';

import { useEffect, useState } from 'react';
import type { Receipt } from '@/lib/api';
import { Skeleton } from '@/components/StatusBadge';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byCapability: Record<string, number>;
  byRisk: Record<string, number>;
  byTool: Record<string, number>;
  byAgent: Record<string, number>;
  policyHitRate: Record<string, number>;
  verificationRate: { verified: number; unverified: number; failed: number };
}

function computeStats(receipts: Receipt[]): Stats {
  const stats: Stats = {
    total: receipts.length,
    byStatus: {},
    byCapability: {},
    byRisk: {},
    byTool: {},
    byAgent: {},
    policyHitRate: {},
    verificationRate: { verified: 0, unverified: 0, failed: 0 },
  };

  for (const r of receipts) {
    stats.byStatus[r.status] = (stats.byStatus[r.status] ?? 0) + 1;
    stats.byCapability[r.capability] = (stats.byCapability[r.capability] ?? 0) + 1;
    stats.byRisk[r.riskLevel] = (stats.byRisk[r.riskLevel] ?? 0) + 1;
    stats.byTool[r.toolName] = (stats.byTool[r.toolName] ?? 0) + 1;
    stats.byAgent[r.agentId] = (stats.byAgent[r.agentId] ?? 0) + 1;

    for (const rule of r.matchedRules) {
      stats.policyHitRate[rule] = (stats.policyHitRate[rule] ?? 0) + 1;
    }

    if (r.verificationStatus === 'verified') stats.verificationRate.verified++;
    else if (r.verificationStatus === 'failed') stats.verificationRate.failed++;
    else stats.verificationRate.unverified++;
  }

  return stats;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xs text-neutral-500 w-32 truncate">{label}</span>
      <div className="flex-1 bg-neutral-100 rounded h-4 overflow-hidden">
        <div className="h-full rounded bg-neutral-800" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-2xs text-neutral-400 w-8 text-right">{value}</span>
    </div>
  );
}

function StatCard({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries.length > 0 ? entries[0][1] : 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-md p-5">
      <h3 className="text-2xs text-neutral-400 uppercase tracking-wide font-medium mb-3">
        {title}
      </h3>
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="text-2xs text-neutral-400">No data</p>
        ) : (
          entries.map(([label, value]) => (
            <Bar key={label} label={label} value={value} max={max} />
          ))
        )}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`${API_URL}/receipts?limit=500`);
      const json = await res.json();
      const receipts: Receipt[] = json.data ?? [];
      setStats(computeStats(receipts));
      setLoading(false);
    };

    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="text-base font-semibold text-neutral-900 mb-4">Stats</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      <h1 className="text-base font-semibold text-neutral-900 mb-4">Stats</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Total Actions" value={stats.total} />
        {Object.entries(stats.byStatus).map(([status, count]) => (
          <SummaryCard key={status} label={status.replace('_', ' ')} value={count} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard title="By Tool" data={stats.byTool} />
        <StatCard title="By Capability" data={stats.byCapability} />
        <StatCard title="By Risk Level" data={stats.byRisk} />
        <StatCard title="Policy Rules Hit" data={stats.policyHitRate} />
        <StatCard title="By Agent" data={stats.byAgent} />
        <StatCard
          title="Verification"
          data={{
            verified: stats.verificationRate.verified,
            unverified: stats.verificationRate.unverified,
            failed: stats.verificationRate.failed,
          }}
        />
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-md p-4">
      <p className="text-2xl font-semibold text-neutral-900">{value}</p>
      <p className="text-2xs text-neutral-400 uppercase tracking-wide mt-1">{label}</p>
    </div>
  );
}
