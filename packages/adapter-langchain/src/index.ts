import type { AgentLedger, WrapOptions } from '@agent-ledger/sdk';
import { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';

/**
 * Structural types matching LangChain's StructuredTool interface.
 * Using structural typing to avoid hard import dependency.
 */
interface StructuredToolLike {
  name: string;
  description: string;
  schema: unknown;
  invoke(input: Record<string, unknown>): Promise<string>;
}

interface LedgerToolOptions {
  /** What to do when approval is required. Defaults to "wait". */
  onApproval?: 'wait' | 'throw' | 'message';
  /** What to do when the tool is denied. Defaults to "message". */
  onDenied?: 'throw' | 'message';
}

/**
 * Wrap LangChain tools with Agent Ledger policy-gated execution.
 *
 * Takes an array of LangChain StructuredTool instances and returns
 * new tool instances that route calls through Agent Ledger.
 *
 * @example
 * ```ts
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { wrapLangChainTools } from '@agent-ledger/adapter-langchain';
 *
 * const ledger = new AgentLedger({ session: { agentId: 'my-agent' } });
 *
 * const tools = [sendEmailTool, createEventTool];
 * const safeTools = wrapLangChainTools(ledger, tools);
 * // Use safeTools with your LangChain agent
 * ```
 */
export function wrapLangChainTools(
  ledger: AgentLedger,
  tools: StructuredToolLike[],
  options?: LedgerToolOptions,
): StructuredToolLike[] {
  const onApproval = options?.onApproval ?? 'wait';
  const onDenied = options?.onDenied ?? 'message';

  return tools.map((tool) => createLedgerTool(ledger, tool, onApproval, onDenied));
}

/**
 * Wrap a single LangChain tool with Agent Ledger.
 */
export function wrapLangChainTool(
  ledger: AgentLedger,
  tool: StructuredToolLike,
  options?: LedgerToolOptions,
): StructuredToolLike {
  return createLedgerTool(
    ledger,
    tool,
    options?.onApproval ?? 'wait',
    options?.onDenied ?? 'message',
  );
}

function createLedgerTool(
  ledger: AgentLedger,
  tool: StructuredToolLike,
  onApproval: 'wait' | 'throw' | 'message',
  onDenied: 'throw' | 'message',
): StructuredToolLike {
  const originalInvoke = tool.invoke.bind(tool);

  const wrapOptions: WrapOptions = {
    onApproval: onApproval === 'message' ? 'skip' : onApproval,
  };

  const wrappedFn = ledger.wrap(
    tool.name,
    async (args: Record<string, unknown>) => {
      const result = await originalInvoke(args);
      return result;
    },
    wrapOptions,
  );

  return {
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    async invoke(input: Record<string, unknown>): Promise<string> {
      try {
        const result = await wrappedFn(input);

        if (result.status === 'pending_approval' && onApproval === 'message') {
          return JSON.stringify({
            status: 'pending_approval',
            receiptId: result.receiptId,
            message:
              `This action requires human approval. Receipt: ${result.receiptId}. ` +
              `Risk: ${result.riskLevel}. Reason: ${result.policyExplanation}`,
          });
        }

        return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      } catch (err) {
        if (err instanceof LedgerDeniedError && onDenied === 'message') {
          return JSON.stringify({
            status: 'denied',
            reason: err.reason,
            message: `Tool denied by policy: ${err.reason}`,
          });
        }
        if (err instanceof ApprovalRequiredError && onApproval === 'message') {
          return JSON.stringify({
            status: 'pending_approval',
            receiptId: err.receiptId,
            message: `This action requires human approval. Receipt: ${err.receiptId}`,
          });
        }
        throw err;
      }
    },
  };
}

export type { StructuredToolLike, LedgerToolOptions };
export { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';
