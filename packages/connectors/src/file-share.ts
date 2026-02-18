import type { PrismaClient } from '@prisma/client';
import type { ToolConnector, ToolResult } from '@agent-ledger/core';

export class FileShareConnector implements ToolConnector {
  name = 'file.share';
  capability = 'FILE_SHARE' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fileName = (args.fileName as string) ?? (args.file_name as string) ?? 'untitled.pdf';
    const sharedWith = (args.sharedWith as string[]) ?? (args.shared_with as string[]) ?? [];
    const permission = (args.permission as string) ?? 'view';
    const owner = (args.owner as string) ?? 'agent@mycompany.com';

    const share = await this.prisma.fileShare.create({
      data: {
        fileName,
        sharedWith: JSON.stringify(sharedWith),
        permission,
        owner,
      },
    });

    return {
      success: true,
      data: { shareId: share.shareId, fileName, sharedWith, permission },
      artifactId: share.shareId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const share = await this.prisma.fileShare.findUnique({ where: { shareId: id } });
    if (!share) return null;
    return {
      shareId: share.shareId,
      fileName: share.fileName,
      sharedWith: JSON.parse(share.sharedWith),
      permission: share.permission,
      owner: share.owner,
      createdAt: share.createdAt.toISOString(),
    };
  }
}
