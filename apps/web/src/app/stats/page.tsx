'use client';

import { useEffect, useState } from 'react';
import type { Receipt } from '@/lib/api';

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

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-32 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded h-5 overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-500 w-8 text-right">{value}</span>
    </div>
  );
}

function StatCard({
  title,
  data,
  color,
}: {
  title: string;
  data: Record<string, number>;
  color: string;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = entries.length > 0 ? entries[0][1] : 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      <div className="space-y-2">
        {entries.length === 0 ? (
          <p className="text-xs text-gray-400">No data</p>
        ) : (
          entries.map(([label, value]) => (
            <Bar key={label} label={label} value={value} max={max} color={color} />
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

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (!stats) return null;

  const STATUS_COLORS: Record<string, string> = {
    executed: 'text-green-700',
    denied: 'text-red-700',
    pending_approval: 'text-yellow-700',
    awaiting_execution: 'text-blue-700',
    failed: 'text-red-700',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Stats</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-xs text-gray-500 mt-1">Total Actions</p>
        </div>
        {Object.entries(stats.byStatus).map(([status, count]) => (
          <div key={status} className="bg-white border border-gray-200 rounded-lg p-4 text-center">
            <p className={`text-3xl font-bold ${STATUS_COLORS[status] ?? 'text-gray-700'}`}>
              {count}
            </p>
            <p className="text-xs text-gray-500 mt-1">{status.replace('_', ' ')}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatCard title="By Tool" data={stats.byTool} color="bg-blue-400" />
        <StatCard title="By Capability" data={stats.byCapability} color="bg-purple-400" />
        <StatCard title="By Risk Level" data={stats.byRisk} color="bg-orange-400" />
        <StatCard title="Policy Rules Hit" data={stats.policyHitRate} color="bg-green-400" />
        <StatCard title="By Agent" data={stats.byAgent} color="bg-cyan-400" />
        <StatCard
          title="Verification"
          data={{
            verified: stats.verificationRate.verified,
            unverified: stats.verificationRate.unverified,
            failed: stats.verificationRate.failed,
          }}
          color="bg-emerald-400"
        />
      </div>
    </div>
  );
}
