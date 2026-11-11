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

/** A sign-in's answer (plan 7 Task 7, #134): null goes on to the account page; every refusal reads the same. */
export function signInMessage(status: number): 'tooMany' | 'signInRefused' | 'failed' | null {
  if (status === 200) return null;
  if (status === 429) return 'tooMany';
  if (status === 400 || status === 401) return 'signInRefused';
  return 'failed';
}

/** Removing a way to sign in: null when removed; the last one stays. */
export function removeMessage(status: number): 'lastMethod' | 'failed' | null {
  if (status === 200) return null;
  return status === 409 ? 'lastMethod' : 'failed';
}

/** The authenticator link's secret, shown as groups of four for typing into an app by hand. */
export function setupKey(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret') ?? '';
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}
