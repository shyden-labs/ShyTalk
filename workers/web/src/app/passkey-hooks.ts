/**
 * What Better Auth's passkey plugin calls while registering (plan 7 Task 5,
 * shyden-labs/ShyTalk#134). `context` is the hash of #133's sign-up or
 * recovery token (null for a signed-in member). Once the plugin has verified
 * the passkey, and before it writes it, `afterRegistration` runs the setup's
 * database part, so a sign-up's member exists before their passkey, and keeps
 * the result where the route that called the plugin reads it, in the same
 * request.
 */
import { APIError } from 'better-auth/api';
import type { PasskeyHooks } from '../auth/better-auth.ts';
import type { Finished } from './finish-setup.ts';
import type { SetupIdentity } from './setup-identity.ts';

export type Prepared = Pick<Finished, 'userId' | 'recoveryCodes'>;

/** A registration's prepared setup, by `preparedKey`, from the hook to the route in one request. */
export type PreparedPasskeys = Map<string, { identity: SetupIdentity; prepared: Prepared }>;

/** A token's setup is kept by its hash (the route knows the token); a member's own by their id (the route knows the session). */
export const preparedKey = (context: string | null | undefined, userId: string): string => context || `session:${userId}`;

export interface PasskeyHookDeps {
  identityByHash(hash: string): Promise<SetupIdentity | Response>;
  prepare(identity: SetupIdentity): Promise<Prepared | Response>;
}

const refused = (): APIError => new APIError('UNAUTHORIZED', { message: 'sign_in_refused' });

export function passkeyHooks(deps: PasskeyHookDeps, store: PreparedPasskeys): PasskeyHooks {
  return {
    async resolveUser(context) {
      if (!context) return null;
      const identity = await deps.identityByHash(context);
      if (identity instanceof Response) return null;
      return { id: identity.userId, name: identity.kind === 'sign-up' ? identity.email : identity.userId };
    },

    async afterRegistration(context, userId) {
      let identity: SetupIdentity;
      if (!context) identity = { kind: 'session', userId };
      else {
        const found = await deps.identityByHash(context);
        // A token only ever sets up its own member: a session's member sending another's token is refused.
        if (found instanceof Response || found.userId !== userId) throw refused();
        identity = found;
      }
      const prepared = await deps.prepare(identity);
      if (prepared instanceof Response) {
        // A spent token is a refusal; anything else (D1 failing) is the server's failure.
        throw new APIError(prepared.status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_SERVER_ERROR', { message: 'setup_refused' });
      }
      store.set(preparedKey(context, userId), { identity, prepared });
    },
  };
}
