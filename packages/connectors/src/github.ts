import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ToolConnector, ToolResult } from '@agent-ledger/core';

export class GitHubCreateIssueConnector implements ToolConnector {
  name = 'github.create_issue';
  capability = 'CALENDAR_WRITE' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const repo = (args.repo as string) ?? 'org/repo';
    const title = (args.title as string) ?? 'Untitled';
    const body = (args.body as string) ?? '';
    const labels = (args.labels as string[]) ?? [];
    const assignees = (args.assignees as string[]) ?? [];

    const issue = await this.prisma.gitHubIssue.create({
      data: {
        repo,
        title,
        bodyHash: createHash('sha256').update(body).digest('hex'),
        labels: JSON.stringify(labels),
        assignees: JSON.stringify(assignees),
      },
    });

    return {
      success: true,
      data: { issueId: issue.issueId, repo, title, labels, assignees },
      artifactId: issue.issueId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const issue = await this.prisma.gitHubIssue.findUnique({ where: { issueId: id } });
    if (!issue) return null;
    return {
      issueId: issue.issueId,
      repo: issue.repo,
      title: issue.title,
      bodyHash: issue.bodyHash,
      labels: JSON.parse(issue.labels),
      assignees: JSON.parse(issue.assignees),
      state: issue.state,
      createdAt: issue.createdAt.toISOString(),
    };
  }
}
