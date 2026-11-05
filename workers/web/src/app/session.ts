/**
 * The app's session (plan 4 Task 3, shyden-labs/ShyTalk#76): the app sends
 * `Authorization: Bearer <token>` (the token sign-in answered, kept in the
 * phone's keychain); Better Auth's bearer plugin finds the session.
 */
import { json } from '../http.ts';
import type { ShyTalkAuth } from '../auth/better-auth.ts';

export interface AppSession {
  userId: string;
  email: string;
  /** When the session began, in milliseconds since the epoch. */
  createdAt: number;
}

/** The request's live session, or null when it has none. */
export async function appSession(request: Request, auth: ShyTalkAuth): Promise<AppSession | null> {
  const found = await auth.api.getSession({ headers: request.headers });
  if (found === null) return null;
  return { userId: found.user.id, email: found.user.email, createdAt: new Date(found.session.createdAt).getTime() };
}

/** The answer to a request that needs a session and has none. */
export const signedOut = (): Response => json(401, { error: 'signed_out' });
