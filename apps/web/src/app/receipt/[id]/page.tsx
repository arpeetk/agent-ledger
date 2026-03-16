'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Receipt } from '@/lib/api';
import { StatusBadge, RiskBadge, VerificationBadge, Skeleton } from '@/components/StatusBadge';

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

  if (loading) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!receipt) return <p className="text-semantic-red text-sm">Receipt not found</p>;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors">
          &larr; Back to Timeline
        </Link>
      </div>

      <div className="mb-1">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-neutral-900">Receipt</h1>
          <StatusBadge status={receipt.status} />
          {verified !== null && (
            <span
              className={`inline-flex items-center gap-1.5 text-2xs font-medium ${
                verified ? 'text-semantic-green' : 'text-semantic-red'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${verified ? 'bg-semantic-green' : 'bg-semantic-red'}`}
              />
              {verified ? 'Signature verified' : 'Signature invalid'}
            </span>
          )}
        </div>
        <p className="font-mono text-2xs text-neutral-400 mt-0.5">{receipt.id}</p>
      </div>

      <div className="bg-white border border-neutral-200 rounded-md divide-y divide-neutral-100 mt-4">
        <Section title="General">
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
          <div className="flex items-start gap-2">
            <span className="text-2xs text-neutral-400 w-28 shrink-0">Risk</span>
            <div className="flex items-center gap-2">
              <RiskBadge level={receipt.riskLevel} />
              {receipt.riskReasons.length > 0 && (
                <span className="text-sm text-neutral-600">{receipt.riskReasons.join(', ')}</span>
              )}
            </div>
          </div>
          {receipt.intent && <Field label="Intent" value={receipt.intent} />}
          <div>
            <span className="text-2xs text-neutral-400">Redacted Args</span>
            <pre className="code-block mt-1 max-h-48">{JSON.stringify(receipt.redactedArgs, null, 2)}</pre>
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
            <div className="flex items-start gap-2">
              <span className="text-2xs text-neutral-400 w-28 shrink-0">Status</span>
              <VerificationBadge status={receipt.verificationStatus} />
            </div>
            {receipt.diffSummary && <Field label="Summary" value={receipt.diffSummary} />}
          </Section>
        )}

        {receipt.signatureB64 && (
          <Section title="Signature">
            <div>
              <span className="text-2xs text-neutral-400">Signature (base64)</span>
              <pre className="code-block mt-1 break-all max-h-48">{receipt.signatureB64}</pre>
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
      <h2 className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-2xs text-neutral-400 w-28 shrink-0">{label}</span>
      <span className={`text-sm ${mono ? 'font-mono text-neutral-700' : 'text-neutral-800'}`}>
        {value}
      </span>
    </div>
  );
}
