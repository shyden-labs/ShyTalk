/**
 * The CI smoke's stand-in for GitHub's API (shyden-labs/ShyTalk#321 AC3), as mail-stand-in.ts stands in for Oracle:
 * the roadmap's Durable Object reads ShyTalk Stories from it through the Worker's real code, its App's real JWT
 * included, when the smoke points `ROADMAP_GITHUB_API` here. It gives an installation token and the board page by
 * page, from one real read recorded with the roadmap's own query (github-board.json, 25 Nov 2026: two pages, 181
 * issues, 11 epics).
 *
 *   node tests/smoke/github-stand-in.ts <port>
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';

interface BoardPage {
  data: { node: { items: { pageInfo: { endCursor: string | null } } } };
}

const PAGES = JSON.parse(readFileSync(new URL('github-board.json', import.meta.url), 'utf8')) as BoardPage[];

/** The page a read asks for: the first with no cursor, else the one after the page that cursor ends. */
function pageAfter(endCursor: string | null): BoardPage | undefined {
  if (endCursor === null) return PAGES[0];
  const at = PAGES.findIndex(({ data }) => data.node.items.pageInfo.endCursor === endCursor);
  return at === -1 ? undefined : PAGES[at + 1];
}

/** A request's whole body. */
function bodyOf(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      resolve(text);
    });
  });
}

/** What GitHub would answer, as the roadmap's reader (workers/web/src/roadmap/github.ts) asks. */
async function answerTo(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
  const { pathname } = new URL(request.url ?? '/', 'http://stand-in');
  if (request.method === 'GET' && pathname === '/health') return { status: 200, body: { ok: true } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'POST, or GET /health' } };
  if (/^\/app\/installations\/\d+\/access_tokens$/u.test(pathname)) {
    // The Worker signs a real JWT with the run's throwaway key; as GitHub, a request without one is refused.
    if (!(request.headers.authorization ?? '').startsWith('Bearer ')) return { status: 401, body: { message: 'Bad credentials' } };
    return { status: 201, body: { token: 'ghs_stand-in' } };
  }
  if (pathname !== '/graphql') return { status: 404, body: { message: 'Not Found' } };
  const { variables } = JSON.parse(await bodyOf(request)) as { variables: { endCursor: string | null } };
  return { status: 200, body: pageAfter(variables.endCursor) ?? { errors: [{ message: `no page after ${String(variables.endCursor)}` }] } };
}

createServer((request, response) => {
  void answerTo(request).then(({ status, body }) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
}).listen(Number(process.argv[2]), '127.0.0.1');
