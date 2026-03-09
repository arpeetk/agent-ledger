import { describe, it, expect } from 'vitest';
import { stableStringify } from '../src/stable-stringify.js';

describe('stableStringify', () => {
  it('produces deterministic output regardless of key order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('sorts keys alphabetically', () => {
    const result = stableStringify({ c: 3, a: 1, b: 2 });
    expect(result).toBe('{"a":1,"b":2,"c":3}');
  });

  it('handles nested objects', () => {
    const obj = { b: { z: 1, a: 2 }, a: 1 };
    const result = stableStringify(obj);
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('handles arrays (preserves order)', () => {
    const obj = { items: [3, 1, 2] };
    const result = stableStringify(obj);
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('handles null and undefined', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBeUndefined();
  });

  it('handles arrays of objects with different key orders', () => {
    const a = {
      list: [
        { z: 1, a: 2 },
        { b: 3, a: 4 },
      ],
    };
    const b = {
      list: [
        { a: 2, z: 1 },
        { a: 4, b: 3 },
      ],
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('handles empty objects and arrays', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify([])).toBe('[]');
  });
});
