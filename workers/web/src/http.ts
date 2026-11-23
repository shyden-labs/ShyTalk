/**
 * The Worker's one JSON helper (plan 4 Task 1, shyden-labs/ShyTalk#74). An
 * answer is never cached unless its caller gives an ETag, which then decides
 * how it may be cached.
 */
export function json(status: number, body: unknown, etag?: string): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (etag === undefined) headers.set('cache-control', 'no-store');
  else headers.set('etag', etag);
  return new Response(JSON.stringify(body), { status, headers });
}
