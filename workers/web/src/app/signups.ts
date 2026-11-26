/**
 * The sign-up switch (shyden-labs/ShyTalk#314; Shyden 2026-11-27, "Setting in GitHub"): each environment's
 * SIGNUPS_OPEN var, set at deploy from that GitHub environment's variable. Only exactly `true` opens organic
 * sign-ups; anything else, unset included, keeps them closed.
 */
export interface SignUpsEnv {
  SIGNUPS_OPEN?: string | undefined;
}

export const signUpsOpen = (env: SignUpsEnv): boolean => env.SIGNUPS_OPEN === 'true';

/** What a sign-up attempt answers while sign-ups are closed. */
export const SIGN_UPS_CLOSED = { error: 'sign_ups_closed' } as const;
