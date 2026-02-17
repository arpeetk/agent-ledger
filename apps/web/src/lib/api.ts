const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export interface Receipt {
  id: string;
  status: string;
  createdAt: string;
  finalizedAt: string | null;
  toolName: string;
  capability: string;
  riskLevel: string;
  riskReasons: string[];
  intent: string | null;
  redactedArgs: Record<string, unknown>;
  policyDecision: string;
  matchedRules: string[];
  policyExplanation: string | null;
  approvalStatus: string | null;
  approvedBy: string | null;
  approvalComment: string | null;
  executionStatus: string | null;
  executionAttempts: number;
  verificationStatus: string | null;
  diffSummary: string | null;
  signatureB64: string | null;
  sessionId: string;
  agentId: string;
}

export async function fetchReceipts(status?: string): Promise<Receipt[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const res = await fetch(`${API_URL}/receipts?${params}`, { cache: 'no-store' });
  const json = await res.json();
  return json.data;
}

export async function fetchReceipt(id: string): Promise<Receipt> {
  const res = await fetch(`${API_URL}/receipts/${id}`, { cache: 'no-store' });
  return res.json();
}

export async function verifyReceipt(id: string): Promise<{ valid: boolean }> {
  const res = await fetch(`${API_URL}/receipts/${id}/verify`, { cache: 'no-store' });
  return res.json();
}

export async function approveReceipt(
  id: string,
  approvedBy: string,
  comment?: string,
): Promise<unknown> {
  const res = await fetch(`${API_URL}/receipts/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy, comment }),
  });
  return res.json();
}

export async function denyReceipt(
  id: string,
  approvedBy: string,
  comment?: string,
): Promise<unknown> {
  const res = await fetch(`${API_URL}/receipts/${id}/deny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy, comment }),
  });
  return res.json();
}
