/**
 * What the closed-testing pages do with each API answer (plan 3 Task 5,
 * shyden-labs/ShyTalk#55). Only a 202 may say a mail is on its way: anything
 * unexpected reads as a failed send, never as "check your email".
 */
export type ApplyMessage = 'sent' | 'invalid' | 'tooMany' | 'sendFailed';

export function applyMessage(status: number): ApplyMessage {
  if (status === 202) return 'sent';
  if (status === 400) return 'invalid';
  if (status === 429) return 'tooMany';
  return 'sendFailed';
}

/** The page a confirm answer leads to, or null when it failed and the person may press again. */
export function confirmTarget(status: number): 'confirmed' | 'link-expired' | null {
  if (status === 200) return 'confirmed';
  if (status === 410) return 'link-expired';
  return null;
}
