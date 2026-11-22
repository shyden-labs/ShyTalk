/**
 * What the staff floor page says for each answer (plan 6.1 Task 4,
 * shyden-labs/ShyTalk#77 AC 4): only a 200 says it saved, and anything
 * unexpected reads as a failure.
 */
export type FloorMessage = 'saved' | 'signedOut' | 'notAllowed' | 'lower' | 'failed';

export function floorMessage(status: number): FloorMessage {
  if (status === 200) return 'saved';
  if (status === 401) return 'signedOut';
  if (status === 403) return 'notAllowed';
  if (status === 409) return 'lower';
  return 'failed';
}
