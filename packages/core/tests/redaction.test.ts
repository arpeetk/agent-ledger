import { describe, it, expect } from 'vitest';
import { redactArgs, hashValue } from '../src/redaction.js';

describe('redactArgs', () => {
  it('preserves safe metadata fields', () => {
    const { redactedArgs, fieldsRedacted } = redactArgs({
      to: ['alice@mycompany.com'],
      subject: 'Test',
      body: 'Sensitive content here',
    });

    expect(redactedArgs.to).toEqual(['alice@mycompany.com']);
    expect(redactedArgs.subject).toBe('Test');
    expect(redactedArgs.body_hash).toBeDefined();
    expect(redactedArgs.body).toBeUndefined();
    expect(fieldsRedacted).toContain('body');
  });

  it('redacts description field', () => {
    const { redactedArgs, fieldsRedacted } = redactArgs({
      title: 'Meeting',
      description: 'Confidential meeting notes',
    });

    expect(redactedArgs.title).toBe('Meeting');
    expect(redactedArgs.description_hash).toBeDefined();
    expect(fieldsRedacted).toContain('description');
  });

  it('preserves boolean and number fields', () => {
    const { redactedArgs } = redactArgs({
      isDraft: true,
      count: 42,
    });

    expect(redactedArgs.isDraft).toBe(true);
    expect(redactedArgs.count).toBe(42);
  });

  it('preserves short string fields', () => {
    const { redactedArgs, fieldsRedacted } = redactArgs({
      platform: 'twitter',
    });

    expect(redactedArgs.platform).toBe('twitter');
    expect(fieldsRedacted).toHaveLength(0);
  });
});

describe('hashValue', () => {
  it('produces consistent hashes', () => {
    const hash1 = hashValue('hello');
    const hash2 = hashValue('hello');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different values', () => {
    const hash1 = hashValue('hello');
    const hash2 = hashValue('world');
    expect(hash1).not.toBe(hash2);
  });

  it('hashes objects via JSON.stringify', () => {
    const hash = hashValue({ key: 'value' });
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
  });
});
