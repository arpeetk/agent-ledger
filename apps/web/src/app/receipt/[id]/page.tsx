'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge, VerificationBadge } from '@/components/StatusBadge';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export default function ReceiptPage() {
  const params = useParams();
  const id = params.id as string;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`${API_URL}/receipts/${id}`);
      const data = await res.json();
      setReceipt(data);
      setLoading(false);

      if (data.signatureB64) {
        const vRes = await fetch(`${API_URL}/receipts/${id}/verify`);
        const vData = await vRes.json();
        setVerified(vData.valid);
      }
    }
    load();
  }, [id]);

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (!receipt) return <p className="text-red-500">Receipt not found</p>;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Timeline
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Receipt</h1>
        <StatusBadge status={receipt.status} />
        {verified !== null && (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${
              verified
                ? 'bg-green-100 text-green-800 border border-green-200'
                : 'bg-red-100 text-red-800 border border-red-200'
            }`}
          >
            <span className="text-base">{verified ? '\u2713' : '\u2717'}</span>
            {verified ? 'Signature verified' : 'Signature invalid'}
          </span>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        <Section title="General">
          <Field label="Receipt ID" value={receipt.id} mono />
          <Field label="Created" value={new Date(receipt.createdAt).toLocaleString()} />
          {receipt.finalizedAt && (
            <Field label="Finalized" value={new Date(receipt.finalizedAt).toLocaleString()} />
          )}
          <Field label="Session" value={receipt.sessionId} mono />
          <Field label="Agent" value={receipt.agentId} />
        </Section>

        <Section title="Request">
          <Field label="Tool" value={receipt.toolName} mono />
          <Field label="Capability" value={receipt.capability} />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-28">Risk</span>
            <RiskBadge level={receipt.riskLevel} />
            {receipt.riskReasons.length > 0 && (
              <span className="text-sm text-gray-600">{receipt.riskReasons.join(', ')}</span>
            )}
          </div>
          {receipt.intent && <Field label="Intent" value={receipt.intent} />}
          <div>
            <span className="text-xs text-gray-500">Redacted Args</span>
            <pre className="text-xs bg-gray-50 p-3 rounded mt-1 overflow-auto border border-gray-100 font-mono">
              {JSON.stringify(receipt.redactedArgs, null, 2)}
            </pre>
          </div>
        </Section>

        <Section title="Policy">
          <Field label="Decision" value={receipt.policyDecision} />
          <Field label="Matched Rules" value={receipt.matchedRules.join(', ') || '(none)'} />
          {receipt.policyExplanation && (
            <Field label="Explanation" value={receipt.policyExplanation} />
          )}
        </Section>

        {receipt.approvalStatus && (
          <Section title="Approval">
            <Field label="Status" value={receipt.approvalStatus} />
            {receipt.approvedBy && <Field label="Approved By" value={receipt.approvedBy} />}
            {receipt.approvalComment && <Field label="Comment" value={receipt.approvalComment} />}
          </Section>
        )}

        {receipt.executionStatus && (
          <Section title="Execution">
            <Field label="Status" value={receipt.executionStatus} />
            <Field label="Attempts" value={String(receipt.executionAttempts)} />
          </Section>
        )}

        {receipt.verificationStatus && (
          <Section title="Verification">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-28">Status</span>
              <VerificationBadge status={receipt.verificationStatus} />
            </div>
            {receipt.diffSummary && <Field label="Summary" value={receipt.diffSummary} />}
          </Section>
        )}

        {receipt.signatureB64 && (
          <Section title="Signature">
            <div>
              <span className="text-xs text-gray-500">Signature (base64)</span>
              <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-auto border border-gray-100 font-mono break-all">
                {receipt.signatureB64}
              </pre>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wider">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-500 w-28 shrink-0">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-gray-700' : 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  );
}
