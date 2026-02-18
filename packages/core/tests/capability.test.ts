import { describe, it, expect } from 'vitest';
import { getCapability } from '../src/capability.js';

describe('getCapability', () => {
  it('maps gmail.send to EMAIL_SEND', () => {
    expect(getCapability('gmail.send')).toBe('EMAIL_SEND');
  });

  it('maps gmail.create_draft to EMAIL_DRAFT', () => {
    expect(getCapability('gmail.create_draft')).toBe('EMAIL_DRAFT');
  });

  it('maps calendar.create_event to CALENDAR_WRITE', () => {
    expect(getCapability('calendar.create_event')).toBe('CALENDAR_WRITE');
  });

  it('maps slack.send_message to EMAIL_SEND', () => {
    expect(getCapability('slack.send_message')).toBe('EMAIL_SEND');
  });

  it('maps github.create_issue to CALENDAR_WRITE', () => {
    expect(getCapability('github.create_issue')).toBe('CALENDAR_WRITE');
  });

  it('maps file.share to FILE_SHARE', () => {
    expect(getCapability('file.share')).toBe('FILE_SHARE');
  });

  it('maps social.post to PUBLIC_POST', () => {
    expect(getCapability('social.post')).toBe('PUBLIC_POST');
  });

  it('maps payments.charge to PAYMENTS', () => {
    expect(getCapability('payments.charge')).toBe('PAYMENTS');
  });

  it('defaults unknown tools to READ_ONLY', () => {
    expect(getCapability('unknown.tool')).toBe('READ_ONLY');
  });
});
