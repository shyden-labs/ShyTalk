import { describe, it, expect } from 'vitest';
import { checkMessage, failureFor, MAIL_MAX_BYTES } from '../../packages/mail/index.ts';
import { secretsMatch } from '../../packages/environment/index.ts';

/**
 * The shared mail check and failure reasons (shyden-labs/ShyTalk#88): both the
 * live Worker and the door use them, so a message is judged and a failure is
 * named the same way on every environment.
 */

const coded = (code: unknown, message = 'x'): Error => Object.assign(new Error(message), { code });

describe('failureFor: each Cloudflare code has its reason', () => {
  it.each([
    ['E_RATE_LIMIT_EXCEEDED', 'rate-limit'],
    ['E_DAILY_LIMIT_EXCEEDED', 'daily-limit'],
    ['E_RECIPIENT_SUPPRESSED', 'suppressed'],
    ['E_SENDER_NOT_VERIFIED', 'sender-not-verified'],
    ['E_DELIVERY_FAILED', 'delivery-failed'],
    ['E_ACCOUNT_SUSPENDED', 'suspended'],
    ['E_INTERNAL_SERVER_ERROR', 'unavailable'],
  ])('%s is %s', (code, reason) => {
    expect(failureFor(coded(code))).toEqual({ ok: false, reason, error: code });
  });

  it('a code it does not know is unknown, with the code kept', () => {
    expect(failureFor(coded('E_SOMETHING_NEW'))).toEqual({ ok: false, reason: 'unknown', error: 'E_SOMETHING_NEW' });
  });

  it('an error with no code is unknown, with no error kept', () => {
    expect(failureFor(new Error('boom'))).toEqual({ ok: false, reason: 'unknown' });
  });

  it('a thrown non-Error is unknown', () => {
    expect(failureFor('boom')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('a code that is not an E_ code is not kept', () => {
    expect(failureFor(coded('a@b.test'))).toEqual({ ok: false, reason: 'unknown' });
  });

  it('never keeps the error message, which may echo the address or the code', () => {
    const text = JSON.stringify(failureFor(coded('E_DELIVERY_FAILED', 'to a@b.test: 123456')));
    expect(text).not.toContain('a@b.test');
    expect(text).not.toContain('123456');
  });
});

const GOOD = { to: 'a@b.test', subject: 'Your code', text: '123456' };

describe('checkMessage: a message that may be sent', () => {
  it('keeps a plain message', () => {
    expect(checkMessage(GOOD)).toEqual(GOOD);
  });

  it('keeps the html part', () => {
    expect(checkMessage({ ...GOOD, html: '<p>123456</p>' })).toEqual({ ...GOOD, html: '<p>123456</p>' });
  });

  it('drops any other field, a caller-chosen sender included', () => {
    expect(checkMessage({ ...GOOD, from: 'boss@shytalk.app' })).toEqual(GOOD);
  });
});

describe('checkMessage: a message that is refused', () => {
  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no address', { subject: 'Your code', text: '123456' }],
    ['two addresses with a comma', { ...GOOD, to: 'a@b.test, c@d.test' }],
    ['two addresses with a semicolon', { ...GOOD, to: 'a@b.test;c@d.test' }],
    ['a display-form address', { ...GOOD, to: '<a@b.test>' }],
    ['no at sign', { ...GOOD, to: 'no-at-sign' }],
    ['an address over 254 characters', { ...GOOD, to: `${'a'.repeat(246)}@b.test12` }],
    ['an empty subject', { ...GOOD, subject: '' }],
    ['a subject over 200 characters', { ...GOOD, subject: 's'.repeat(201) }],
    ['a carriage return in the subject', { ...GOOD, subject: 'Hi\rBcc: x@y.test' }],
    ['a line feed in the subject', { ...GOOD, subject: 'Hi\nBcc: x@y.test' }],
    ['an empty text', { ...GOOD, text: '' }],
    ['html that is not text', { ...GOOD, html: 7 }],
    ['a message over the size limit', { ...GOOD, text: 'x'.repeat(MAIL_MAX_BYTES) }],
  ])('%s', (_name, value) => {
    expect(checkMessage(value)).toBeNull();
  });

  it('keeps a 254-character address and a 200-character subject', () => {
    const edge = { ...GOOD, to: `${'a'.repeat(245)}@b.test12`, subject: 's'.repeat(200) };
    expect(edge.to).toHaveLength(254);
    expect(checkMessage(edge)).toEqual(edge);
  });
});

describe('secretsMatch', () => {
  it('matches the same secret', async () => {
    expect(await secretsMatch('s', 's')).toBe(true);
  });

  it.each([
    ['a different secret', 's', 't'],
    ['two empty secrets', '', ''],
    ['no configured secret', 's', undefined],
    ['nothing given and none configured', '', undefined],
  ])('refuses %s', async (_name, given, configured) => {
    expect(await secretsMatch(given, configured)).toBe(false);
  });
});
