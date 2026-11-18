/**
 * The website's session cookie is renewed on use (shyden-labs/ShyTalk#184; Shyden 2026-11-13, "Re-set on use").
 * The cookie lives 400 days, the browser's ceiling, while a session row lasts until it is ended (#134 AC5), so an
 * active member would be signed out on day 400. Each signed-in request the website answers therefore sets the
 * cookie again for a fresh 400 days; a member who stays away for 400 days still loses it.
 */
import type { ShyTalkAuth } from '../auth/better-auth.ts';
import { sessionCookie } from './code-sign-in.ts';

/** Whether the request's `Cookie` header holds a cookie called `name`. */
const sendsCookie = (request: Request, name: string): boolean =>
  (request.headers.get('cookie') ?? '').split(';').some((pair) => pair.trim().startsWith(`${name}=`));

/** Whether `answer` sets the cookie called `name` itself, as a sign-in or sign-out does. */
const setsCookie = (answer: Response, name: string): boolean =>
  answer.headers.getSetCookie().some((cookie) => cookie.startsWith(`${name}=`));

/**
 * `answer`, with the session cookie set again for 400 days when the request sent the session cookie and it still
 * finds a live session. Read after the route ran, so a session the route ended is not renewed. The app's bearer
 * requests send no session cookie and get none; an answer setting the cookie itself, and a WebSocket upgrade's
 * 101 (which a copy would lose its socket from), go out as they are.
 */
export async function renewSessionCookie(request: Request, answer: Response, auth: ShyTalkAuth): Promise<Response> {
  if (answer.status === 101) return answer;
  const { name } = (await auth.$context).authCookies.sessionToken;
  if (!sendsCookie(request, name) || setsCookie(answer, name)) return answer;
  const found = await auth.api.getSession({ headers: request.headers });
  if (found === null) return answer;
  const renewed = new Response(answer.body, answer);
  renewed.headers.append('set-cookie', await sessionCookie(auth, found.session.token));
  return renewed;
}
