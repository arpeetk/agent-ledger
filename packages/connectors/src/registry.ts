import type { PrismaClient } from '@prisma/client';
import type { ToolConnector } from '@agent-ledger/core';
import { GmailSendConnector, GmailCreateDraftConnector } from './gmail.js';
import { CalendarCreateEventConnector } from './calendar.js';
import { SlackSendMessageConnector } from './slack.js';
import { GitHubCreateIssueConnector } from './github.js';
import { FileShareConnector } from './file-share.js';

export class ConnectorRegistry {
  private connectors: Map<string, ToolConnector> = new Map();

  constructor(prisma: PrismaClient) {
    this.register(new GmailSendConnector(prisma));
    this.register(new GmailCreateDraftConnector(prisma));
    this.register(new CalendarCreateEventConnector(prisma));
    this.register(new SlackSendMessageConnector(prisma));
    this.register(new GitHubCreateIssueConnector(prisma));
    this.register(new FileShareConnector(prisma));
  }

  register(connector: ToolConnector) {
    this.connectors.set(connector.name, connector);
  }

  get(toolName: string): ToolConnector | undefined {
    return this.connectors.get(toolName);
  }

  has(toolName: string): boolean {
    return this.connectors.has(toolName);
  }

  list(): string[] {
    return Array.from(this.connectors.keys());
  }
}
