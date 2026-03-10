import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { AgentLedger, WrapOptions, LedgerResult } from '@agent-ledger/sdk';
import { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';

// ── Types ──

/** JSON Schema definition for tool parameters. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/** A tool definition for the MCP adapter. */
export interface LedgerMcpTool {
  /** Human-readable description shown to the MCP client. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: JsonSchema;
  /** The handler function that executes the tool. */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Options for creating an MCP server. */
export interface CreateMcpServerOptions {
  /** Server name shown to MCP clients. */
  name?: string;
  /** Server version. */
  version?: string;
  /** Default wrap options for all tools. */
  wrapOptions?: WrapOptions;
  /**
   * How to handle denied tool calls:
   * - "error": Return an MCP error result (default).
   * - "message": Return a human-readable message to the LLM.
   */
  onDenied?: 'error' | 'message';
  /**
   * How to handle approval-required tool calls:
   * - "wait": Block until approved/denied (default).
   * - "error": Return an MCP error result immediately.
   * - "message": Return a human-readable message to the LLM.
   */
  onApproval?: 'wait' | 'error' | 'message';
}

/**
 * Create an MCP server with Agent Ledger policy-gated tools.
 *
 * Every tool call is routed through the ledger for policy evaluation,
 * approval workflows, and receipt generation.
 *
 * @example
 * ```ts
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { createMcpServer } from '@agent-ledger/adapter-mcp';
 *
 * const ledger = new AgentLedger({
 *   session: { agentId: 'mcp-agent', userId: 'user-1' },
 * });
 *
 * const { server, start } = createMcpServer(ledger, {
 *   send_email: {
 *     description: 'Send an email',
 *     inputSchema: {
 *       type: 'object',
 *       properties: {
 *         to: { type: 'string' },
 *         subject: { type: 'string' },
 *         body: { type: 'string' },
 *       },
 *       required: ['to', 'subject', 'body'],
 *     },
 *     handler: async ({ to, subject }) => {
 *       return { sent: true, to, subject };
 *     },
 *   },
 * });
 *
 * await start();
 * ```
 */
export function createMcpServer(
  ledger: AgentLedger,
  tools: Record<string, LedgerMcpTool>,
  options?: CreateMcpServerOptions,
): { server: McpServer; start: () => Promise<void> } {
  const serverName = options?.name ?? 'agent-ledger';
  const serverVersion = options?.version ?? '0.1.0';
  const onDenied = options?.onDenied ?? 'error';
  const onApproval = options?.onApproval ?? 'wait';

  const mcpServer = new McpServer(
    { name: serverName, version: serverVersion },
    { capabilities: { tools: {} } },
  );

  for (const [toolName, toolDef] of Object.entries(tools)) {
    registerLedgerTool(mcpServer, ledger, toolName, toolDef, {
      wrapOptions: options?.wrapOptions,
      onDenied,
      onApproval,
    });
  }

  async function start() {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
  }

  return { server: mcpServer, start };
}

function registerLedgerTool(
  mcpServer: McpServer,
  ledger: AgentLedger,
  toolName: string,
  toolDef: LedgerMcpTool,
  options: {
    wrapOptions?: WrapOptions;
    onDenied: 'error' | 'message';
    onApproval: 'wait' | 'error' | 'message';
  },
) {
  const onApprovalSdk: 'wait' | 'throw' | 'skip' =
    options.onApproval === 'error' ? 'throw' : options.onApproval === 'message' ? 'skip' : 'wait';

  const wrapOptions: WrapOptions = {
    ...options.wrapOptions,
    onApproval: onApprovalSdk,
  };

  const wrappedFn = ledger.wrap(toolName, toolDef.handler, wrapOptions);

  // Note: McpServer.tool() accepts Zod shapes for parameters, not JSON Schema.
  // If inputSchema.properties is provided, pass it as a Zod-compatible shape.
  // For now, we pass the description and let the MCP client handle schema discovery.
  mcpServer.tool(toolName, toolDef.description, async (args: Record<string, unknown>) => {
    try {
      const result: LedgerResult = await wrappedFn(args);

      if (result.status === 'pending_approval') {
        if (options.onApproval === 'message') {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `This action requires human approval before it can be executed.\n` +
                  `Receipt ID: ${result.receiptId}\n` +
                  `Risk: ${result.riskLevel ?? 'unknown'}\n` +
                  `Reason: ${result.policyExplanation ?? 'Policy requires approval.'}`,
              },
            ],
          };
        }
        return {
          content: [
            { type: 'text' as const, text: `Awaiting approval. Receipt: ${result.receiptId}` },
          ],
          isError: true,
        };
      }

      const text =
        typeof result.result === 'object'
          ? JSON.stringify(result.result, null, 2)
          : String(result.result ?? '');

      return {
        content: [{ type: 'text' as const, text }],
        _meta: { receiptId: result.receiptId },
      };
    } catch (err) {
      if (err instanceof LedgerDeniedError) {
        if (options.onDenied === 'message') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `This action was denied by policy: ${err.reason}\nReceipt ID: ${err.receiptId}`,
              },
            ],
          };
        }
        return {
          content: [{ type: 'text' as const, text: `Denied: ${err.reason}` }],
          isError: true,
        };
      }

      if (err instanceof ApprovalRequiredError) {
        if (options.onApproval === 'message') {
          return {
            content: [
              {
                type: 'text' as const,
                text: `This action requires human approval.\nReceipt ID: ${err.receiptId}`,
              },
            ],
          };
        }
        return {
          content: [
            { type: 'text' as const, text: `Approval required. Receipt: ${err.receiptId}` },
          ],
          isError: true,
        };
      }

      // Don't leak internal error details to the LLM
      console.error(`[mcp-adapter] Tool "${toolName}" error:`, err);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Tool "${toolName}" encountered an internal error. Please try again or contact support.`,
          },
        ],
        isError: true,
      };
    }
  });
}

/**
 * Convenience function to create and immediately start an MCP server over stdio.
 *
 * @example
 * ```ts
 * import { AgentLedger } from '@agent-ledger/sdk';
 * import { serveMcp } from '@agent-ledger/adapter-mcp';
 *
 * const ledger = new AgentLedger({
 *   session: { agentId: 'mcp-agent' },
 * });
 *
 * await serveMcp(ledger, {
 *   send_email: {
 *     description: 'Send an email',
 *     inputSchema: { type: 'object', properties: { to: { type: 'string' } }, required: ['to'] },
 *     handler: async ({ to }) => ({ sent: true, to }),
 *   },
 * });
 * ```
 */
export async function serveMcp(
  ledger: AgentLedger,
  tools: Record<string, LedgerMcpTool>,
  options?: CreateMcpServerOptions,
): Promise<void> {
  const { start } = createMcpServer(ledger, tools, options);
  await start();
}

export { LedgerDeniedError, ApprovalRequiredError } from '@agent-ledger/sdk';
