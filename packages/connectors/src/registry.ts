import type { PrismaClient } from '@prisma/client';
import type { ToolConnector } from '@agent-ledger/core';
import { GmailSendConnector, GmailCreateDraftConnector } from './gmail.js';
import { CalendarCreateEventConnector } from './calendar.js';

export class ConnectorRegistry {
  private connectors: Map<string, ToolConnector> = new Map();

  constructor(prisma: PrismaClient) {
    this.register(new GmailSendConnector(prisma));
    this.register(new GmailCreateDraftConnector(prisma));
    this.register(new CalendarCreateEventConnector(prisma));
  }

  private register(connector: ToolConnector) {
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
