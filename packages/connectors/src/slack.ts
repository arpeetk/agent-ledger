import type { PrismaClient } from '@prisma/client';
import type { ToolConnector, ToolResult } from '@agent-ledger/core';

export class SlackSendMessageConnector implements ToolConnector {
  name = 'slack.send_message';
  capability = 'EMAIL_SEND' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const channel = (args.channel as string) ?? '#general';
    const text = (args.text as string) ?? '';
    const from = (args.from as string) ?? 'agent-bot';
    const threadTs = args.thread_ts as string | undefined;

    const msg = await this.prisma.slackMessage.create({
      data: { channel, from, text, threadTs },
    });

    return {
      success: true,
      data: { messageId: msg.messageId, channel, from, preview: text.slice(0, 100) },
      artifactId: msg.messageId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const msg = await this.prisma.slackMessage.findUnique({ where: { messageId: id } });
    if (!msg) return null;
    return {
      messageId: msg.messageId,
      channel: msg.channel,
      from: msg.from,
      text: msg.text,
      threadTs: msg.threadTs,
      createdAt: msg.createdAt.toISOString(),
    };
  }
}
