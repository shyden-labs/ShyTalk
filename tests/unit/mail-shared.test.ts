import { describe, it, expect } from 'vitest';
import { checkMessage, failureFor, resultFor, MAIL_MAX_BYTES } from '../../packages/mail/index.ts';

/**
 * The shared mail rules (shyden-labs/ShyTalk#88): what may be sent, and how an
 * Oracle Email Delivery answer becomes a result. Only Oracle's `code` and the
 * HTTP status are kept, never its `message`, which may echo the address.
 */

const TO = 'member@example.test';
const MESSAGE = { to: TO, subject: 'Your ShyTalk code', text: 'Your code is 482913.' };

describe('failureFor', () => {
  it.each([
    [400, 'invalid'],
    [401, 'not-authenticated'],
    [404, 'sender-not-approved'],
    [413, 'too-large'],
    [429, 'rate-limit'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('names a %i as %s, keeping the code', (status, reason) => {
    expect(failureFor(status, { code: 'X', message: `to ${TO}` })).toEqual({ ok: false, reason, status, error: 'X' });
  });

  it('names any other status unknown', () => {
    expect(failureFor(418, { code: 'X' })).toEqual({ ok: false, reason: 'unknown', status: 418, error: 'X' });
  });

  it('keeps no error when the body has no code', () => {
    expect(failureFor(404, { message: 'no' })).toEqual({ ok: false, reason: 'sender-not-approved', status: 404 });
  });

  it('keeps no error when the body is not an object', () => {
    expect(failureFor(503, '<html>down</html>')).toEqual({ ok: false, reason: 'unavailable', status: 503 });
  });

  it('keeps no error when the body is null', () => {
    expect(failureFor(503, null)).toEqual({ ok: false, reason: 'unavailable', status: 503 });
  });

  it('keeps no code that is not letters only', () => {
    expect(failureFor(400, { code: TO })).toEqual({ ok: false, reason: 'invalid', status: 400 });
  });

  // Measured 2026-11-08 (shyden-labs/ShyTalk#88): the submission endpoint
  // answers `{"code": "400 MissingParameter", ...}`, the status before the word.
  it("keeps the word of a code that leads with Oracle's status", () => {
    expect(failureFor(400, { code: '400 MissingParameter' })).toEqual({
      ok: false,
      reason: 'invalid',
      status: 400,
      error: 'MissingParameter',
    });
  });

  it('keeps no code whose part after the status is not letters only', () => {
    expect(failureFor(404, { code: `404 ${TO}` })).toEqual({ ok: false, reason: 'sender-not-approved', status: 404 });
  });

  it('never keeps the message, which may echo the address or the code', () => {
    const text = JSON.stringify(failureFor(400, { code: 'InvalidParameter', message: `to ${TO}: 123456` }));
    expect(text).not.toContain(TO);
    expect(text).not.toContain('123456');
  });
});

describe('resultFor', () => {
  it('answers the message id of an accepted send', () => {
    expect(resultFor(200, { messageId: 'm', envelopeId: 'e', suppressedRecipients: [] }, TO)).toEqual({ ok: true, messageId: 'm' });
  });

  it('answers suppressed when Oracle names the recipient, in any letter case', () => {
    const body = { messageId: 'm', envelopeId: 'e', suppressedRecipients: [{ email: TO.toUpperCase() }] };
    expect(resultFor(200, body, TO)).toEqual({ ok: false, reason: 'suppressed', status: 200 });
  });

  it('ignores a suppressed list naming someone else', () => {
    const body = { messageId: 'm', envelopeId: 'e', suppressedRecipients: [{ email: 'other@example.test' }, 'junk'] };
    expect(resultFor(200, body, TO)).toEqual({ ok: true, messageId: 'm' });
  });

  it('answers unavailable for a 200 with no message id', () => {
    expect(resultFor(200, {}, TO)).toEqual({ ok: false, reason: 'unavailable', status: 200 });
  });

  it('answers unavailable for a 200 with an empty message id', () => {
    expect(resultFor(200, { messageId: '' }, TO)).toEqual({ ok: false, reason: 'unavailable', status: 200 });
  });

  it('answers unavailable for a 200 that is not an object', () => {
    expect(resultFor(200, 'ok', TO)).toEqual({ ok: false, reason: 'unavailable', status: 200 });
  });

  it('names a failure status through failureFor', () => {
    expect(resultFor(404, { code: 'NotAuthorizedOrNotFound' }, TO)).toEqual({
      ok: false,
      reason: 'sender-not-approved',
      status: 404,
      error: 'NotAuthorizedOrNotFound',
    });
  });
});

describe('checkMessage', () => {
  it('accepts a message', () => {
    expect(checkMessage(MESSAGE)).toEqual(MESSAGE);
  });

  it('keeps an html body', () => {
    expect(checkMessage({ ...MESSAGE, html: '<p>Your code</p>' })).toEqual({ ...MESSAGE, html: '<p>Your code</p>' });
  });

  it('drops any other field, a sender included', () => {
    expect(checkMessage({ ...MESSAGE, from: 'someone@example.test' })).toEqual(MESSAGE);
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no address', { subject: MESSAGE.subject, text: MESSAGE.text }],
    ['a comma list', { ...MESSAGE, to: 'a@b.test, c@d.test' }],
    ['a semicolon list', { ...MESSAGE, to: 'a@b.test;c@d.test' }],
    ['a bracketed address', { ...MESSAGE, to: '<a@b.test>' }],
    ['no at sign', { ...MESSAGE, to: 'no-at-sign' }],
    ['a 255-character address', { ...MESSAGE, to: `${'a'.repeat(243)}@example.test` }],
    ['a non-ASCII address', { ...MESSAGE, to: 'josé@example.test' }],
    ['an empty subject', { ...MESSAGE, subject: '' }],
    ['a 201-character subject', { ...MESSAGE, subject: 's'.repeat(201) }],
    ['a carriage return in the subject', { ...MESSAGE, subject: 'a\rBcc: x@y.test' }],
    ['a line feed in the subject', { ...MESSAGE, subject: 'a\nBcc: x@y.test' }],
    ['an empty text', { ...MESSAGE, text: '' }],
    ['an html that is not a string', { ...MESSAGE, html: 1 }],
    ['an oversized message', { ...MESSAGE, text: 'x'.repeat(MAIL_MAX_BYTES) }],
  ])('refuses %s', (_name, value) => {
    expect(checkMessage(value)).toBeNull();
  });

  it('accepts a 254-character address', () => {
    const to = `${'a'.repeat(241)}@example.test`;
    expect(to).toHaveLength(254);
    expect(checkMessage({ ...MESSAGE, to })).toEqual({ ...MESSAGE, to });
  });
});
