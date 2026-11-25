/**
 * The CI smoke's stand-in for GitHub's API (shyden-labs/ShyTalk#321 AC3), as mail-stand-in.ts stands in for Oracle:
 * the roadmap's Durable Object reads ShyTalk Stories from it, through the Worker's real code, when the smoke sets
 * `ROADMAP_GITHUB_API` to it. It answers an installation token and the board read page by page, from one real read
 * of the board recorded with the roadmap's own query (github-board.json, 25 Nov 2026: 2 pages, 181 issues, 11 epics).
 *
 *   node tests/smoke/github-stand-in.ts <port>
 *
 * `GET /health` answers once it listens.
 */
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';

interface BoardPage {
  data: {
    node: {
      title: string;
      items: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: unknown[] };
    };
  };
}

const port = Number(process.argv[2]);
const pages = JSON.parse(readFileSync(new URL('github-board.json', import.meta.url), 'utf8')) as BoardPage[];

/** The page a read asks for: the first with no cursor, else the one after the page whose end cursor it names. */
function pageFor(endCursor: string | null): BoardPage | undefined {
  if (endCursor === null) return pages[0];
  const at = pages.findIndex((page) => page.data.node.items.pageInfo.endCursor === endCursor);
  return at === -1 ? undefined : pages[at + 1];
}

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      resolve(text);
    });
    request.on('error', reject);
  });
}

interface Answer {
  status: number;
  value: unknown;
}

/** GitHub's answer to one request, as the roadmap's reader sees it (workers/web/src/roadmap/github.ts). */
async function answerTo(request: IncomingMessage): Promise<Answer> {
  const { pathname } = new URL(request.url ?? '/', 'http://stand-in');
  if (request.method === 'GET' && pathname === '/health') return { status: 200, value: { ok: true } };
  if (request.method !== 'POST') return { status: 405, value: { error: 'POST, or GET /health' } };
  if (/^\/app\/installations\/\d+\/access_tokens$/u.test(pathname)) {
    // The Worker signs a real JWT with the run's throwaway key; the stand-in only needs to see one was sent.
    if (!(request.headers.authorization ?? '').startsWith('Bearer ')) return { status: 401, value: { message: 'Bad credentials' } };
    return { status: 201, value: { token: 'ghs_stand-in' } };
  }
  if (pathname !== '/graphql') return { status: 404, value: { message: 'Not Found' } };
  const { variables } = JSON.parse(await body(request)) as { variables: { id: string; endCursor: string | null } };
  const page = pageFor(variables.endCursor);
  return { status: 200, value: page ?? { errors: [{ message: `no page after ${String(variables.endCursor)}` }] } };
}

createServer((request, response) => {
  void answerTo(request).then(({ status, value }) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  });
}).listen(port, '127.0.0.1');
