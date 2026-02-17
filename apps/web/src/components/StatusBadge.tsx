'use client';

const STATUS_COLORS: Record<string, string> = {
  executed: 'bg-green-100 text-green-800',
  denied: 'bg-red-100 text-red-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-800';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  const color = RISK_COLORS[level] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}

export function VerificationBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const color =
    status === 'verified'
      ? 'bg-green-100 text-green-700'
      : status === 'failed'
        ? 'bg-red-100 text-red-700'
        : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}
