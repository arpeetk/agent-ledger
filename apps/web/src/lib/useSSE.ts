'use client';

import { useEffect, useRef } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

/**
 * Hook that connects to the SSE endpoint and calls onEvent whenever a receipt event arrives.
 * Falls back to polling if SSE connection fails.
 */
export function useSSE(onEvent: () => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    try {
      es = new EventSource(`${API_URL}/events`);

      const handler = () => {
        onEventRef.current();
      };

      // Listen for all receipt event types
      const events = [
        'receipt.created',
        'receipt.updated',
        'receipt.denied',
        'receipt.pending_approval',
        'receipt.executed',
        'receipt.approved',
        'receipt.approval_denied',
      ];
      for (const event of events) {
        es.addEventListener(event, handler);
      }

      es.onerror = () => {
        // If SSE fails, fall back to polling
        es?.close();
        es = null;
        if (!fallbackInterval) {
          fallbackInterval = setInterval(() => onEventRef.current(), 2000);
        }
      };
    } catch {
      // SSE not available, use polling
      fallbackInterval = setInterval(() => onEventRef.current(), 2000);
    }

    return () => {
      es?.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, []);
}
