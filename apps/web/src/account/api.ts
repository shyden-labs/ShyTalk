/**
 * How the account pages reach the app's API (plan 7 Task 7,
 * shyden-labs/ShyTalk#133, #134): JSON in and out with the site's own
 * cookies. A lost connection answers status 0, which every page's answer
 * mapping reads as a failure. Every call names platform `web`, which has no
 * version floor (plan 6.1 Task 3, shyden-labs/ShyTalk#77).
 */
const PLATFORM = { 'x-shytalk-platform': 'web' };
export interface Answer {
  status: number;
  body: unknown;
}

/** `path` under `base`: the app API by default, or `/api/staff/` for the staff pages. */
export async function call(path: string, body?: unknown, method: 'GET' | 'POST' | 'DELETE' = 'POST', base = '/api/app/'): Promise<Answer> {
  const init: RequestInit =
    method === 'POST'
      ? { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...PLATFORM }, body: JSON.stringify(body) }
      : { method, credentials: 'same-origin', headers: PLATFORM };
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch {
    return { status: 0, body: null };
  }
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
}
