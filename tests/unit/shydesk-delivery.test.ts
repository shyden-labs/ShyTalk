import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { suspensionDelivery } from '../support/shydesk-delivery.ts';
import { shydeskCallbackSecret, smokeShydeskSecret } from '../smoke/targets.ts';

/**
 * The ShyDesk suspension the sign-in journeys deliver (shyden-labs/ShyTalk#343 AC2): signed as ShyDesk signs it, with
 * the CI run's secret made from its door secret, or DEV's own on the phones.
 */

describe('suspensionDelivery', () => {
  it('suspends the member for 7 days, signed v1= with the hex HMAC-SHA256 of timestamp.body', () => {
    const { body, headers } = suspensionDelivery('secret-1', 'u-1', 1_795_400_000);
    const sent = JSON.parse(body) as Record<string, unknown>;
    expect(sent).toMatchObject({
      type: 'punishment.apply',
      product: 'shytalk',
      subject_user_id: 'u-1',
      punishment: { key: 'suspend-7d', duration_seconds: 604_800 },
    });
    expect(typeof sent['punishment_id']).toBe('string');
    const another = JSON.parse(suspensionDelivery('secret-1', 'u-1', 1_795_400_000).body) as Record<string, unknown>;
    expect(sent['punishment_id']).not.toBe(another['punishment_id']);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['shydesk-timestamp']).toBe('1795400000');
    const wanted = createHmac('sha256', 'secret-1').update(`1795400000.${body}`).digest('hex');
    expect(headers['shydesk-signature']).toBe(`v1=${wanted}`);
  });
});

describe('shydeskCallbackSecret', () => {
  it('is the hex SHA-256 of the run’s door secret under its own label', () => {
    const wanted = createHash('sha256').update('shytalk-smoke-shydesk-callback:door-1').digest('hex');
    expect(shydeskCallbackSecret('door-1')).toBe(wanted);
    expect(shydeskCallbackSecret('door-2')).not.toBe(wanted);
  });
});

describe('smokeShydeskSecret', () => {
  it('takes the phone run’s secret first, else makes the CI run’s from its door secret', () => {
    expect(smokeShydeskSecret({ SMOKE_SHYDESK_CALLBACK_SECRET: 'dev-secret', SMOKE_DOOR_SECRET: 'door-1' })).toBe('dev-secret');
    expect(smokeShydeskSecret({ SMOKE_SHYDESK_CALLBACK_SECRET: '', SMOKE_DOOR_SECRET: 'door-1' })).toBe(shydeskCallbackSecret('door-1'));
  });

  it('fails naming both when neither is set', () => {
    expect(() => smokeShydeskSecret({})).toThrow(/SMOKE_SHYDESK_CALLBACK_SECRET.*SMOKE_DOOR_SECRET/u);
  });
});
