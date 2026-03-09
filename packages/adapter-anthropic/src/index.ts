import type { AgentLedger } from '@agent-ledger/sdk';
import { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';

/**
 * Structural types for Anthropic SDK tool_use, avoiding hard import.
 */
interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** A handler function that executes the actual tool logic. */
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

interface LedgerToolConfig {
  /** The Anthropic tool definition (sent to Claude). */
  definition: AnthropicToolDefinition;
  /** The handler that executes the tool. */
  handler: ToolHandler;
}

interface ProcessOptions {
  /** What to do when approval is required. Defaults to "wait". */
  onApproval?: 'wait' | 'throw' | 'message';
  /** What to do when the tool is denied. Defaults to "message". */
  onDenied?: 'throw' | 'message';
}

/**
 * Create a ledger-aware tool processor for Anthropic Claude tool_use.
 *
 * @example
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { createToolProcessor } from '@agent-ledger/adapter-anthropic';
 *
 * const ledger = new AgentLedger({ session: { agentId: 'my-claude-agent' } });
 * const anthropic = new Anthropic();
 *
 * const processor = createToolProcessor(ledger, {
 *   send_email: {
 *     definition: {
 *       name: 'send_email',
 *       description: 'Send an email',
 *       input_schema: {
 *         type: 'object',
 *         properties: { to: { type: 'string' }, subject: { type: 'string' } },
 *         required: ['to', 'subject'],
 *       },
 *     },
 *     handler: async ({ to, subject }) => {
 *       return { sent: true, to, subject };
 *     },
 *   },
 * });
 *
 * // Get tool definitions to send to Claude
 * const tools = processor.definitions();
 *
 * // Process a tool_use block from Claude's response
 * const toolResult = await processor.process(toolUseBlock);
 * // Returns a tool_result block ready to send back to Claude
 * ```
 */
export function createToolProcessor(
  ledger: AgentLedger,
  tools: Record<string, LedgerToolConfig>,
  options?: ProcessOptions,
) {
  const onApproval = options?.onApproval ?? 'wait';
  const onDenied = options?.onDenied ?? 'message';

  return {
    /** Get Anthropic tool definitions to pass to the API. */
    definitions(): AnthropicToolDefinition[] {
      return Object.values(tools).map((t) => t.definition);
    },

    /** Process a tool_use block from Claude, returning a tool_result block. */
    async process(toolUse: ToolUseBlock): Promise<ToolResultBlock> {
      const config = tools[toolUse.name];
      if (!config) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Unknown tool: ${toolUse.name}`,
          is_error: true,
        };
      }

      const wrappedFn = ledger.wrap(toolUse.name, config.handler, {
        onApproval: onApproval === 'message' ? 'skip' : onApproval,
      });

      try {
        const result = await wrappedFn(toolUse.input);

        if (result.status === 'pending_approval' && onApproval === 'message') {
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              status: 'pending_approval',
              receiptId: result.receiptId,
              message:
                `This action requires human approval. Receipt: ${result.receiptId}. ` +
                `Risk: ${result.riskLevel}. Reason: ${result.policyExplanation}`,
            }),
          };
        }

        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content:
            typeof result.result === 'string' ? result.result : JSON.stringify(result.result),
        };
      } catch (err) {
        if (err instanceof LedgerDeniedError && onDenied === 'message') {
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              status: 'denied',
              reason: err.reason,
              message: `Tool denied by policy: ${err.reason}`,
            }),
          };
        }
        if (err instanceof ApprovalRequiredError && onApproval === 'message') {
          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              status: 'pending_approval',
              receiptId: err.receiptId,
              message: `This action requires human approval. Receipt: ${err.receiptId}`,
            }),
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: message,
          is_error: true,
        };
      }
    },

    /** Process all tool_use blocks from a Claude response. */
    async processAll(toolUses: ToolUseBlock[]): Promise<ToolResultBlock[]> {
      return Promise.all(toolUses.map((tu) => this.process(tu)));
    },
  };
}

export type {
  AnthropicToolDefinition,
  ToolUseBlock,
  ToolResultBlock,
  LedgerToolConfig,
  ToolHandler,
};
export { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';
