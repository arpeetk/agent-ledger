import type { AgentLedger, WrapOptions } from '@agent-ledger/sdk';
import { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';

/**
 * A Vercel AI SDK tool definition.
 * We use a structural type to avoid hard dependency on the `ai` package types.
 */
interface VercelTool {
  description?: string;
  parameters: unknown;
  execute?: (args: Record<string, unknown>) => Promise<unknown>;
}

type ToolMap = Record<string, VercelTool>;

interface WithLedgerOptions {
  /**
   * What to do when approval is required:
   * - "wait": Block and poll until approved/denied (default).
   * - "throw": Throw an ApprovalRequiredError immediately.
   * - "message": Return a human-readable message to the LLM explaining the tool is awaiting approval.
   */
  onApproval?: 'wait' | 'throw' | 'message';
  /**
   * What to do when the tool is denied:
   * - "throw": Throw a LedgerDeniedError (default).
   * - "message": Return a human-readable message to the LLM explaining the denial.
   */
  onDenied?: 'throw' | 'message';
}

/**
 * Wrap Vercel AI SDK tools with Agent Ledger policy-gated execution.
 *
 * @example
 * ```ts
 * import { tool } from 'ai';
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { withLedger } from '@agent-ledger/adapter-vercel-ai';
 *
 * const ledger = new AgentLedger({
 *   session: { agentId: 'my-agent' },
 * });
 *
 * const tools = withLedger(ledger, {
 *   sendEmail: tool({
 *     description: 'Send an email',
 *     parameters: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
 *     execute: async ({ to, subject, body }) => {
 *       // your email sending logic
 *       return { sent: true, to };
 *     },
 *   }),
 * });
 * ```
 */
export function withLedger<T extends ToolMap>(
  ledger: AgentLedger,
  tools: T,
  options?: WithLedgerOptions,
): T {
  const onApproval = options?.onApproval ?? 'wait';
  const onDenied = options?.onDenied ?? 'throw';

  const wrapped = {} as Record<string, VercelTool>;

  for (const [toolName, toolDef] of Object.entries(tools)) {
    const originalExecute = toolDef.execute;

    wrapped[toolName] = {
      ...toolDef,
      execute: async (args: Record<string, unknown>) => {
        if (!originalExecute) {
          throw new Error(`Tool "${toolName}" has no execute function`);
        }

        const wrapOptions: WrapOptions = {
          onApproval: onApproval === 'message' ? 'skip' : onApproval,
        };

        const wrappedFn = ledger.wrap(
          toolName,
          (a: Record<string, unknown>) => originalExecute(a),
          wrapOptions,
        );

        try {
          const result = await wrappedFn(args);

          if (result.status === 'pending_approval' && onApproval === 'message') {
            return {
              _ledger: {
                status: 'pending_approval',
                receiptId: result.receiptId,
                message:
                  `This action requires human approval before it can be executed. ` +
                  `Receipt ID: ${result.receiptId}. ` +
                  `Risk: ${result.riskLevel}. ` +
                  `Reason: ${result.policyExplanation ?? 'Policy requires approval for this action.'}`,
              },
            };
          }

          return result.result;
        } catch (err) {
          if (err instanceof LedgerDeniedError && onDenied === 'message') {
            return {
              _ledger: {
                status: 'denied',
                receiptId: err.receiptId,
                message: `This action was denied by policy: ${err.reason}`,
              },
            };
          }
          if (err instanceof ApprovalRequiredError && onApproval === 'message') {
            return {
              _ledger: {
                status: 'pending_approval',
                receiptId: err.receiptId,
                message: `This action requires human approval. Receipt ID: ${err.receiptId}`,
              },
            };
          }
          throw err;
        }
      },
    };
  }

  return wrapped as T;
}

export { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';
