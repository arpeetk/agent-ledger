import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ToolConnector, ToolResult } from '@agent-ledger/core';

export class CalendarCreateEventConnector implements ToolConnector {
  name = 'calendar.create_event';
  capability = 'CALENDAR_WRITE' as const;

  constructor(private prisma: PrismaClient) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const title = (args.title as string) ?? 'Untitled Event';
    const startTime = (args.startTime as string) ?? (args.start_time as string) ?? '';
    const endTime = (args.endTime as string) ?? (args.end_time as string) ?? '';
    const attendees = (args.attendees as string[]) ?? [];
    const description = (args.description as string) ?? '';

    const event = await this.prisma.calendarEvent.create({
      data: {
        title,
        startTime,
        endTime,
        attendees: JSON.stringify(attendees),
        descriptionHash: createHash('sha256').update(description).digest('hex'),
      },
    });

    return {
      success: true,
      data: { eventId: event.eventId, title, startTime, endTime, attendees },
      artifactId: event.eventId,
    };
  }

  async getById(id: string): Promise<Record<string, unknown> | null> {
    const event = await this.prisma.calendarEvent.findUnique({ where: { eventId: id } });
    if (!event) return null;
    return {
      eventId: event.eventId,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      attendees: JSON.parse(event.attendees),
      descriptionHash: event.descriptionHash,
      createdAt: event.createdAt.toISOString(),
    };
  }
}
