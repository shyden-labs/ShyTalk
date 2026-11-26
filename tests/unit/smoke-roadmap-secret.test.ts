import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { roadmapWebhookSecret, smokeWebhookSecret } from '../smoke/targets.ts';

/**
 * The webhook secret the live roadmap test signs with (shyden-labs/ShyTalk#321 AC3): on CI made from the run's door
 * secret, so the Worker and every Playwright process agree on it; on the phones DEV's own, given by the phone run.
 */

describe('roadmapWebhookSecret', () => {
  it('is the hex SHA-256 of the run’s door secret under its own label, the same in every process', () => {
    const wanted = createHash('sha256').update('shytalk-smoke-roadmap-webhook:door-1').digest('hex');
    expect(roadmapWebhookSecret('door-1')).toBe(wanted);
    expect(roadmapWebhookSecret('door-2')).not.toBe(wanted);
  });
});

describe('smokeWebhookSecret', () => {
  it('takes the phone run’s secret first', () => {
    expect(smokeWebhookSecret({ SMOKE_ROADMAP_WEBHOOK_SECRET: 'dev-secret', SMOKE_DOOR_SECRET: 'door-1' })).toBe('dev-secret');
  });

  it('makes the CI run’s from its door secret when no phone secret is given', () => {
    const wanted = createHash('sha256').update('shytalk-smoke-roadmap-webhook:door-1').digest('hex');
    expect(smokeWebhookSecret({ SMOKE_DOOR_SECRET: 'door-1' })).toBe(wanted);
    expect(smokeWebhookSecret({ SMOKE_ROADMAP_WEBHOOK_SECRET: '', SMOKE_DOOR_SECRET: 'door-1' })).toBe(roadmapWebhookSecret('door-1'));
    expect(smokeWebhookSecret({ SMOKE_DOOR_SECRET: 'door-1' })).toBe(roadmapWebhookSecret('door-1'));
  });

  it.each([{}, { SMOKE_ROADMAP_WEBHOOK_SECRET: '', SMOKE_DOOR_SECRET: '' }])(
    'fails naming both settings when neither is set: %j',
    (env) => {
      expect(() => smokeWebhookSecret(env)).toThrow(
        'neither SMOKE_ROADMAP_WEBHOOK_SECRET nor SMOKE_DOOR_SECRET is set: the live roadmap test cannot sign a delivery',
      );
    },
  );

  it('reads the process environment by default', () => {
    const before = { ...process.env };
    process.env.SMOKE_ROADMAP_WEBHOOK_SECRET = 'from-env';
    try {
      expect(smokeWebhookSecret()).toBe('from-env');
    } finally {
      process.env = before;
    }
  });
});
