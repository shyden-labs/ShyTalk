import { createHmac, randomUUID } from 'node:crypto';

/**
 * A 7-day ShyDesk suspension of `userId`, signed as ShyDesk signs it (shyden-labs/ShyTalk#310): `v1=` and the hex
 * HMAC-SHA256 of `timestamp.body` under `secret`, stamped `now` (seconds). The sign-in journeys deliver it to the
 * Worker's `/api/shydesk/callback` to block their member (shyden-labs/ShyTalk#343 AC2). Each has its own id.
 */
export function suspensionDelivery(secret: string, userId: string, now: number): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify({
    type: 'punishment.apply',
    punishment_id: `smoke-${randomUUID()}`,
    product: 'shytalk',
    subject_user_id: userId,
    punishment: { key: 'suspend-7d', label: 'Suspended for 7 days', duration_seconds: 604_800 },
    report_ticket_id: 'tkt-smoke',
    appeal_url: 'https://shytalk.app/appeal',
    issued_at: now * 1000,
  });
  const timestamp = String(now);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return {
    body,
    headers: { 'content-type': 'application/json', 'shydesk-timestamp': timestamp, 'shydesk-signature': `v1=${signature}` },
  };
}
