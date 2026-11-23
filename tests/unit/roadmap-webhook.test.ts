import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature, webhookVerdict } from '../../workers/web/src/roadmap/webhook.ts';

/**
 * The roadmap's GitHub webhook (shyden-labs/ShyTalk#321 AC1; Yawelo Idle's
 * worker/webhook.ts): only a delivery signed with the environment's secret is
 * believed, and only an event about ShyTalk's own repository or board starts a
 * board read, since an organisation webhook delivers every repository's events.
 */

const SECRET = 'the-webhook-secret';
const BODY = '{"action":"edited"}';
/** GitHub's `X-Hub-Signature-256` for `body`, worked out here with Node's own HMAC, apart from the code under test. */
const signed = (body: string, secret = SECRET): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('the signature', () => {
  it('accepts a delivery signed with the secret', async () => {
    expect(await verifySignature(SECRET, BODY, signed(BODY))).toBe(true);
  });

  it('refuses a delivery signed with another secret', async () => {
    expect(await verifySignature(SECRET, BODY, signed(BODY, 'another-secret'))).toBe(false);
  });

  it('refuses a body changed after signing', async () => {
    expect(await verifySignature(SECRET, '{"action":"deleted"}', signed(BODY))).toBe(false);
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['no sha256= prefix', signed(BODY).slice('sha256='.length)],
    ['the old sha1 form', `sha1=${createHmac('sha1', SECRET).update(BODY).digest('hex')}`],
    ['a short signature', signed(BODY).slice(0, -2)],
    ['a signature that is not hex', `sha256=${'z'.repeat(64)}`],
  ])('refuses %s', async (_, header) => {
    expect(await verifySignature(SECRET, BODY, header)).toBe(false);
  });

  it('refuses everything when the secret is empty, even a body signed with the empty secret', async () => {
    expect(await verifySignature('', BODY, signed(BODY, ''))).toBe(false);
  });
});

describe('which events start a board read', () => {
  const ours = { repo: 'shyden-labs/ShyTalk', boardId: 'PVT_kwDOEOcG584BpkXr' };

  it('answers a ping as a ping', () => {
    expect(webhookVerdict('ping', { zen: 'Keep it simple.' }, ours)).toBe('ping');
  });

  it('reads the board on an issue event in ShyTalk’s own repository', () => {
    expect(webhookVerdict('issues', { action: 'closed', repository: { full_name: 'shyden-labs/ShyTalk' } }, ours)).toBe('read');
  });

  it('reads the board on a change to a card on ShyTalk’s own board', () => {
    expect(webhookVerdict('projects_v2_item', { action: 'edited', projects_v2_item: { project_node_id: ours.boardId } }, ours)).toBe(
      'read',
    );
  });

  it.each([
    ['an issue event in another repository', 'issues', { repository: { full_name: 'shyden-labs/yawelo-idle' } }],
    ['a card on another board', 'projects_v2_item', { projects_v2_item: { project_node_id: 'PVT_other' } }],
    ['an issue event naming no repository', 'issues', {}],
    ['a card event naming no board', 'projects_v2_item', { projects_v2_item: {} }],
    ['any other event', 'push', { repository: { full_name: 'shyden-labs/ShyTalk' } }],
    ['a payload that is not an object', 'issues', null],
  ])('ignores %s', (_, event, payload) => {
    expect(webhookVerdict(event, payload, ours)).toBe('ignore');
  });
});
