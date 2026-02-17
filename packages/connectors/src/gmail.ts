import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ToolConnector, ToolResult } from '@agent-ledger/core';

export class GmailSendConnector implements ToolConnector {
  name = 'gmail.send';
  capability = 'EMAIL_SEND' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const to = args.to as string[];
    const from = (args.from as string) ?? 'agent@mycompany.com';
    const subject = (args.subject as string) ?? '(no subject)';
    const body = (args.body as string) ?? '';

    const email = await this.prisma.email.create({
      data: {
        isDraft: false,
        from,
        to: JSON.stringify(to),
        subject,
        bodyHash: createHash('sha256').update(body).digest('hex'),
      },
    });

    return {
      success: true,
      data: { messageId: email.messageId, from, to, subject },
      artifactId: email.messageId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const email = await this.prisma.email.findUnique({ where: { messageId: id } });
    if (!email) return null;
    return {
      messageId: email.messageId,
      isDraft: email.isDraft,
      from: email.from,
      to: JSON.parse(email.to),
      subject: email.subject,
      bodyHash: email.bodyHash,
      createdAt: email.createdAt.toISOString(),
    };
  }
}

export class GmailCreateDraftConnector implements ToolConnector {
  name = 'gmail.create_draft';
  capability = 'EMAIL_DRAFT' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const to = args.to as string[];
    const from = (args.from as string) ?? 'agent@mycompany.com';
    const subject = (args.subject as string) ?? '(no subject)';
    const body = (args.body as string) ?? '';

    const email = await this.prisma.email.create({
      data: {
        isDraft: true,
        from,
        to: JSON.stringify(to),
        subject,
        bodyHash: createHash('sha256').update(body).digest('hex'),
      },
    });

    return {
      success: true,
      data: { draftId: email.messageId, from, to, subject },
      artifactId: email.messageId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const email = await this.prisma.email.findUnique({ where: { messageId: id } });
    if (!email) return null;
    return {
      messageId: email.messageId,
      isDraft: email.isDraft,
      from: email.from,
      to: JSON.parse(email.to),
      subject: email.subject,
      bodyHash: email.bodyHash,
      createdAt: email.createdAt.toISOString(),
    };
  }
}
