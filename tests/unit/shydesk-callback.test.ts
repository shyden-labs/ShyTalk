import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { checkCallback, SKEW_SECONDS } from '../../workers/web/src/moderation/shydesk-callback.ts';

/**
 * ShyDesk's punishment callback (shyden-labs/ShyTalk#310 AC1; contract: shyden-labs/shydesk openapi/shydesk.v1.yaml,
 * schema PunishmentCallback, sent 2026-11-22; its body as ShyDesk's src/punishments/send.ts builds it, #349): a POST signed `ShyDesk-Signature: v1=<hex HMAC-SHA256 of timestamp + "." + raw body>` with
 * `ShyDesk-Timestamp` in unix seconds. Only a signed, fresh delivery of a known type for ShyTalk is believed; each
 * refusal names its error code.
 */

const SECRET = 'the-callback-secret';
const NOW = 1_795_400_000;

const apply = {
  type: 'punishment.apply',
  punishment_id: 'pun_1',
  product: 'shytalk',
  subject_user_id: 'user_7',
  punishment: { key: 'suspend_7d', label: 'Suspended for 7 days', duration_seconds: 604_800 },
  report_ticket_id: 'tkt_9',
  appeal_url: 'https://shytalk.app/appeal#appeal=abc',
  // Unix milliseconds, a JSON number, as ShyDesk sends it (#349).
  issued_at: 1_795_399_990_000,
};
const ISSUED_AT = '2026-11-23T02:13:10.000Z';

const sign = (timestamp: string, body: string, secret = SECRET) =>
  `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

function delivery(payload: unknown, options: { at?: number; signature?: string | null; timestamp?: string | null } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const timestamp = options.timestamp === undefined ? String(options.at ?? NOW) : options.timestamp;
  const signature = options.signature === undefined ? sign(timestamp ?? '', body) : options.signature;
  return { body, timestamp, signature };
}

const check = (d: ReturnType<typeof delivery>, secret = SECRET) => checkCallback(secret, d.timestamp, d.signature, d.body, NOW);

describe('ShyDesk’s punishment callback', () => {
  it('believes a signed, fresh punishment.apply and reads its fields', async () => {
    expect(await check(delivery(apply))).toEqual({
      ok: true,
      event: {
        type: 'punishment.apply',
        punishmentId: 'pun_1',
        subjectUserId: 'user_7',
        punishment: { key: 'suspend_7d', label: 'Suspended for 7 days', durationSeconds: 604_800 },
        reportTicketId: 'tkt_9',
        appealUrl: 'https://shytalk.app/appeal#appeal=abc',
        issuedAt: ISSUED_AT,
      },
    });
  });

  // shyden-labs/ShyTalk#349: the warning ShyDesk sent on 2026-11-24, field for field as its send.ts builds it.
  it('believes the body ShyDesk sends for a warning with no end, its issue time in Unix milliseconds', async () => {
    const warning = {
      type: 'punishment.apply',
      punishment_id: '0b6f2c1e-0000-4000-8000-000000000349',
      product: 'shytalk',
      subject_user_id: 'probe-310-member',
      punishment: { key: 'warning', label: 'Warning', duration_seconds: null },
      report_ticket_id: '373d7e44-60fb-4c0c-801f-98b790225e2a',
      appeal_url: 'https://site.example.test/appeal#appeal=t',
      issued_at: 1_795_399_990_000,
    };
    const result = await check(delivery(warning));
    expect(result.ok && result.event.issuedAt).toBe(ISSUED_AT);
    expect(result.ok && result.event.punishment).toEqual({ key: 'warning', label: 'Warning', durationSeconds: null });
  });

  it('believes an apply with no appeal address, which ShyDesk leaves out when the product has no appeal page', async () => {
    const result = await check(delivery({ ...apply, appeal_url: undefined }));
    expect(result.ok && result.event.appealUrl).toBeNull();
  });

  it('believes a punishment.lift, which carries no appeal address, and a ban with no end', async () => {
    const lift = {
      ...apply,
      type: 'punishment.lift',
      appeal_url: undefined,
      punishment: { key: 'ban', label: 'Banned', duration_seconds: null },
    };
    const result = await check(delivery(lift));
    expect(result.ok && result.event).toMatchObject({ type: 'punishment.lift', appealUrl: null, punishment: { durationSeconds: null } });
  });

  it.each([
    ['another secret', { signature: sign(String(NOW), JSON.stringify(apply), 'another') }],
    ['no signature', { signature: null }],
    ['a signature without v1=', { signature: sign(String(NOW), JSON.stringify(apply)).slice(3) }],
    ['a signature that is not hex', { signature: `v1=${'z'.repeat(64)}` }],
  ])('refuses %s with 401 bad_signature', async (_name, options) => {
    expect(await check(delivery(apply, options))).toEqual({ ok: false, status: 401, error: 'bad_signature' });
  });

  it('refuses everything when the Worker holds no secret', async () => {
    expect(await check(delivery(apply, { signature: sign(String(NOW), JSON.stringify(apply), '') }), '')).toEqual({
      ok: false,
      status: 401,
      error: 'bad_signature',
    });
  });

  it.each([NOW - SKEW_SECONDS - 1, NOW + SKEW_SECONDS + 1])(
    'refuses a timestamp more than 300 s off (%i) with 401 stale_timestamp',
    async (at) => {
      expect(await check(delivery(apply, { at }))).toEqual({ ok: false, status: 401, error: 'stale_timestamp' });
    },
  );

  it.each([NOW - SKEW_SECONDS, NOW + SKEW_SECONDS])('believes a timestamp exactly 300 s off (%i)', async (at) => {
    expect((await check(delivery(apply, { at }))).ok).toBe(true);
  });

  it.each([null, '', 'soon', '1.5'])('refuses a timestamp of %j with 400 bad_timestamp', async (timestamp) => {
    expect(await check(delivery(apply, { timestamp }))).toEqual({ ok: false, status: 400, error: 'bad_timestamp' });
  });

  it('refuses a signed body that is not JSON with 400 bad_payload', async () => {
    expect(await check(delivery('not json'))).toEqual({ ok: false, status: 400, error: 'bad_payload' });
  });

  it.each(['null', '5', '"text"'])('refuses a signed body of %s, which is no object, with 400 bad_payload', async (body) => {
    expect(await check(delivery(body))).toEqual({ ok: false, status: 400, error: 'bad_payload' });
  });

  it('refuses an unknown type with 422 unknown_type', async () => {
    expect(await check(delivery({ ...apply, type: 'punishment.extend' }))).toEqual({ ok: false, status: 422, error: 'unknown_type' });
  });

  it('refuses another product’s punishment with 422 wrong_product', async () => {
    expect(await check(delivery({ ...apply, product: 'yawelo-idle' }))).toEqual({ ok: false, status: 422, error: 'wrong_product' });
  });

  it.each([
    ['no punishment id', { punishment_id: '' }],
    ['no subject', { subject_user_id: undefined }],
    ['no punishment key', { punishment: { label: 'x', duration_seconds: 1 } }],
    ['a punishment that is only a word', { punishment: 'ban' }],
    ['a negative duration', { punishment: { key: 'k', label: 'x', duration_seconds: -1 } }],
    ['an empty appeal address', { appeal_url: '' }],
    ['no issue time', { issued_at: undefined }],
    ['an issue time as text', { issued_at: '2026-11-23T07:00:00Z' }],
    ['a negative issue time', { issued_at: -1 }],
    ['an issue time that is not whole milliseconds', { issued_at: 1.5 }],
    ['an issue time past what a date can hold', { issued_at: 9e15 }],
    ['no report ticket', { report_ticket_id: null }],
  ])('refuses %s with 400 bad_payload', async (_name, change) => {
    expect(await check(delivery({ ...apply, ...change }))).toEqual({ ok: false, status: 400, error: 'bad_payload' });
  });
});
