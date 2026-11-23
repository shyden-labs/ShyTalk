/**
 * How the account pages reach the app's API (plan 7 Task 7,
 * shyden-labs/ShyTalk#133, #134): JSON in and out with the site's own
 * cookies. A lost connection answers status 0, which every page's answer
 * mapping reads as a failure.
 */
export interface Answer {
  status: number;
  body: unknown;
}

export async function call(path: string, body?: unknown, method: 'GET' | 'POST' | 'DELETE' = 'POST'): Promise<Answer> {
  const init: RequestInit =
    method === 'POST'
      ? { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method, credentials: 'same-origin' };
  let response: Response;
  try {
    response = await fetch(`/api/app/${path}`, init);
  } catch {
    return { status: 0, body: null };
  }
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
}
