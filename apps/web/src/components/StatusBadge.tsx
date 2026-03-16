'use client';

const STATUS_DOTS: Record<string, { dot: string; text: string }> = {
  executed: { dot: 'bg-semantic-green', text: 'text-semantic-green' },
  denied: { dot: 'bg-semantic-red', text: 'text-semantic-red' },
  pending_approval: { dot: 'bg-semantic-amber', text: 'text-semantic-amber' },
  failed: { dot: 'bg-semantic-red', text: 'text-semantic-red' },
  awaiting_execution: { dot: 'bg-semantic-blue', text: 'text-semantic-blue' },
};

const RISK_DOTS: Record<string, { dot: string; text: string }> = {
  low: { dot: 'bg-semantic-green', text: 'text-semantic-green' },
  medium: { dot: 'bg-semantic-amber', text: 'text-semantic-amber' },
  high: { dot: 'bg-semantic-red', text: 'text-semantic-red' },
};

export function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_DOTS[status] ?? { dot: 'bg-neutral-400', text: 'text-neutral-500' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-medium ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {status.replace('_', ' ')}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  const colors = RISK_DOTS[level] ?? { dot: 'bg-neutral-400', text: 'text-neutral-500' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-medium ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {level}
    </span>
  );
}

export function VerificationBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const colors =
    status === 'verified'
      ? { dot: 'bg-semantic-green', text: 'text-semantic-green' }
      : status === 'failed'
        ? { dot: 'bg-semantic-red', text: 'text-semantic-red' }
        : { dot: 'bg-neutral-400', text: 'text-neutral-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xs font-medium ${colors.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {status}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  const widths = ['w-4', 'w-28', 'w-20', 'w-14', 'w-16', 'w-20'];
  return (
    <div className="space-y-0">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 h-10 px-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className={`skeleton h-3 ${widths[j % widths.length]}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
