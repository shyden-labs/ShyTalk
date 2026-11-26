/**
 * The DEV secrets this Mac also needs, each with its Keychain service (account `shytalk`) and, where the phone run
 * hands it to the smoke tests, the variable it goes in (shyden-labs/ShyTalk#386). `scripts/dev-secret.ts` sets each
 * in GitHub's `dev` environment and the Keychain together; `tests/phones/run.ts` reads the same list.
 */
export interface MacDevSecret {
  /** The secret's name in the `dev` environment. */
  readonly name: string;
  /** Its Keychain service on this Mac. */
  readonly keychain: string;
  /** The variable the phone run gives it to the smoke tests as, if it gives it. */
  readonly smoke?: string;
}

export const MAC_DEV_SECRETS: readonly MacDevSecret[] = [
  { name: 'ROADMAP_WEBHOOK_SECRET', keychain: 'shytalk-dev-roadmap-webhook-secret', smoke: 'SMOKE_ROADMAP_WEBHOOK_SECRET' },
  { name: 'SHYDESK_CALLBACK_SECRET', keychain: 'shytalk-dev-shydesk-callback-secret', smoke: 'SMOKE_SHYDESK_CALLBACK_SECRET' },
  { name: 'DEV_ACCESS_CLIENT_ID', keychain: 'shytalk-ci-dev-access-client-id' },
  { name: 'DEV_ACCESS_CLIENT_SECRET', keychain: 'shytalk-ci-dev-access-client-secret' },
];
