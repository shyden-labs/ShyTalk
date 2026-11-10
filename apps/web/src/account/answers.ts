/**
 * What the sign-up and recovery pages say for each API answer (plan 6 Task 6,
 * shyden-labs/ShyTalk#133). A start reads as the closed-testing form's
 * `applyMessage`; only a 200 may say a code was accepted or a recovery
 * cancelled, and anything unexpected reads as a failure.
 */
export type VerifyMessage = 'confirmed' | 'invalid' | 'codeRefused' | 'tooMany' | 'failed';

export function verifyMessage(status: number): VerifyMessage {
  if (status === 200) return 'confirmed';
  if (status === 400) return 'invalid';
  if (status === 401) return 'codeRefused';
  if (status === 429) return 'tooMany';
  return 'failed';
}

export function cancelMessage(status: number): 'cancelled' | 'failed' {
  return status === 200 ? 'cancelled' : 'failed';
}
