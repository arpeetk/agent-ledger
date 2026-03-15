import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { redactArgs, hashValue } from '../src/redaction.js';

function expectedHash(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(str).digest('hex');
}

describe('redactArgs', () => {
  describe('redacted fields', () => {
    it('hashes the body field and records it as redacted', () => {
      const result = redactArgs({ body: 'Secret email body content' });
      expect(result.redactedArgs).toHaveProperty('body_hash');
      expect(result.redactedArgs).not.toHaveProperty('body');
      expect(result.redactedArgs.body_hash).toBe(expectedHash('Secret email body content'));
      expect(result.fieldsRedacted).toContain('body');
    });

    it('hashes the description field', () => {
      const result = redactArgs({ description: 'Event details' });
      expect(result.redactedArgs).toHaveProperty('description_hash');
      expect(result.fieldsRedacted).toContain('description');
    });

    it('hashes the content field', () => {
      const result = redactArgs({ content: 'Some content' });
      expect(result.redactedArgs).toHaveProperty('content_hash');
      expect(result.fieldsRedacted).toContain('content');
    });

    it('hashes the message field', () => {
      const result = redactArgs({ message: 'A message' });
      expect(result.redactedArgs).toHaveProperty('message_hash');
      expect(result.fieldsRedacted).toContain('message');
    });
  });

  describe('safe fields', () => {
    it('preserves to, from, cc, bcc fields as-is', () => {
      const args = {
        to: ['alice@example.com'],
        from: 'bob@example.com',
        cc: ['carol@example.com'],
        bcc: ['dave@example.com'],
      };
      const result = redactArgs(args);
      expect(result.redactedArgs.to).toEqual(['alice@example.com']);
      expect(result.redactedArgs.from).toBe('bob@example.com');
      expect(result.redactedArgs.cc).toEqual(['carol@example.com']);
      expect(result.redactedArgs.bcc).toEqual(['dave@example.com']);
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('preserves subject and title fields', () => {
      const result = redactArgs({ subject: 'Hello', title: 'Meeting' });
      expect(result.redactedArgs.subject).toBe('Hello');
      expect(result.redactedArgs.title).toBe('Meeting');
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('preserves time-related fields', () => {
      const args = {
        startTime: '2025-01-01T10:00:00Z',
        endTime: '2025-01-01T11:00:00Z',
        start_time: '2025-01-01T10:00:00Z',
        end_time: '2025-01-01T11:00:00Z',
      };
      const result = redactArgs(args);
      expect(result.redactedArgs.startTime).toBe('2025-01-01T10:00:00Z');
      expect(result.redactedArgs.endTime).toBe('2025-01-01T11:00:00Z');
      expect(result.redactedArgs.start_time).toBe('2025-01-01T10:00:00Z');
      expect(result.redactedArgs.end_time).toBe('2025-01-01T11:00:00Z');
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('preserves attendees and draft flags', () => {
      const args = { attendees: ['a@b.com'], isDraft: true, is_draft: false };
      const result = redactArgs(args);
      expect(result.redactedArgs.attendees).toEqual(['a@b.com']);
      expect(result.redactedArgs.isDraft).toBe(true);
      expect(result.redactedArgs.is_draft).toBe(false);
      expect(result.fieldsRedacted).toEqual([]);
    });
  });

  describe('numbers and booleans', () => {
    it('preserves number values in non-safe fields', () => {
      const result = redactArgs({ priority: 5 });
      expect(result.redactedArgs.priority).toBe(5);
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('preserves boolean values in non-safe fields', () => {
      const result = redactArgs({ urgent: true });
      expect(result.redactedArgs.urgent).toBe(true);
      expect(result.fieldsRedacted).toEqual([]);
    });
  });

  describe('unknown string fields', () => {
    it('preserves short strings (<= 200 chars)', () => {
      const result = redactArgs({ note: 'A short note' });
      expect(result.redactedArgs.note).toBe('A short note');
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('preserves strings exactly 200 chars long', () => {
      const str = 'x'.repeat(200);
      const result = redactArgs({ note: str });
      expect(result.redactedArgs.note).toBe(str);
      expect(result.fieldsRedacted).toEqual([]);
    });

    it('hashes strings longer than 200 chars', () => {
      const str = 'x'.repeat(201);
      const result = redactArgs({ note: str });
      expect(result.redactedArgs).toHaveProperty('note_hash');
      expect(result.redactedArgs).not.toHaveProperty('note');
      expect(result.redactedArgs.note_hash).toBe(expectedHash(str));
      expect(result.fieldsRedacted).toContain('note');
    });
  });

  describe('empty args', () => {
    it('returns empty redacted args and no redacted fields', () => {
      const result = redactArgs({});
      expect(result.redactedArgs).toEqual({});
      expect(result.fieldsRedacted).toEqual([]);
    });
  });

  describe('mixed redacted and safe fields', () => {
    it('correctly handles a mix of field types', () => {
      const args = {
        to: ['alice@example.com'],
        subject: 'Meeting notes',
        body: 'Confidential meeting notes here',
        priority: 1,
        urgent: false,
        note: 'Brief note',
      };
      const result = redactArgs(args);

      expect(result.redactedArgs.to).toEqual(['alice@example.com']);
      expect(result.redactedArgs.subject).toBe('Meeting notes');
      expect(result.redactedArgs).toHaveProperty('body_hash');
      expect(result.redactedArgs).not.toHaveProperty('body');
      expect(result.redactedArgs.priority).toBe(1);
      expect(result.redactedArgs.urgent).toBe(false);
      expect(result.redactedArgs.note).toBe('Brief note');
      expect(result.fieldsRedacted).toEqual(['body']);
    });
  });
});

describe('hashValue', () => {
  it('produces a consistent SHA-256 hex hash for strings', () => {
    const hash1 = hashValue('hello');
    const hash2 = hashValue('hello');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces the correct SHA-256 hash', () => {
    const expected = createHash('sha256').update('hello').digest('hex');
    expect(hashValue('hello')).toBe(expected);
  });

  it('hashes objects via JSON.stringify', () => {
    const obj = { key: 'value', num: 42 };
    const expected = createHash('sha256').update(JSON.stringify(obj)).digest('hex');
    expect(hashValue(obj)).toBe(expected);
  });

  it('hashes arrays via JSON.stringify', () => {
    const arr = [1, 2, 3];
    const expected = createHash('sha256').update(JSON.stringify(arr)).digest('hex');
    expect(hashValue(arr)).toBe(expected);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashValue('hello')).not.toBe(hashValue('world'));
  });

  it('hashes numbers via JSON.stringify', () => {
    const expected = createHash('sha256').update(JSON.stringify(42)).digest('hex');
    expect(hashValue(42)).toBe(expected);
  });
});
