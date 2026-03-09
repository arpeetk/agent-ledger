/** Base error for all Agent Ledger SDK errors. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** Thrown when a tool call is denied by policy. */
export class LedgerDeniedError extends LedgerError {
  constructor(
    public readonly toolName: string,
    public readonly receiptId: string,
    public readonly reason: string,
  ) {
    super(`Tool "${toolName}" denied: ${reason} (receipt: ${receiptId})`);
    this.name = 'LedgerDeniedError';
  }
}

/** Thrown when a tool call requires approval and onApproval is "throw". */
export class ApprovalRequiredError extends LedgerError {
  constructor(
    public readonly toolName: string,
    public readonly receiptId: string,
  ) {
    super(
      `Tool "${toolName}" requires approval (receipt: ${receiptId}). ` +
        `Approve at the Agent Ledger dashboard.`,
    );
    this.name = 'ApprovalRequiredError';
  }
}
