'use client';

import { useEffect, useState } from 'react';
import type { Receipt } from '@/lib/api';
import { ReceiptCard } from '@/components/ReceiptCard';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export default function TimelinePage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      const res = await fetch(`${API_URL}/receipts?${params}`);
      const json = await res.json();
      setReceipts(json.data ?? []);
      setLoading(false);
    };

    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Timeline</h1>
        <div className="flex gap-2">
          {['', 'pending_approval', 'executed', 'denied'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded text-sm ${
                filter === s
                  ? 'bg-gray-900 text-white'
                  : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : receipts.length === 0 ? (
        <p className="text-gray-500">
          No receipts yet. Run <code className="bg-gray-100 px-1 rounded">npm run demo</code> to
          generate some.
        </p>
      ) : (
        <div className="space-y-3">
          {receipts.map((r) => (
            <ReceiptCard key={r.id} receipt={r} />
          ))}
        </div>
      )}
    </div>
  );
}
