import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { describe, it, expect, vi } from 'vitest';

// The stand-in is a script: it reads its port from argv and listens at once. node:http is stood in, so no socket
// opens; the request listener it hands createServer is driven directly (as tests/unit/mail-stand-in.test.ts does).
const listen = vi.fn();
let handler: RequestListener | undefined;
vi.mock('node:http', () => ({
  createServer: (listener: RequestListener) => {
    handler = listener;
    return { listen };
  },
}));
const argv = process.argv;
process.argv = [...argv.slice(0, 2), '8790'];
await import('../smoke/github-stand-in.ts');
process.argv = argv;
const listened = listen.mock.calls.slice();

/** The recorded board read the stand-in serves (shyden-labs/ShyTalk#321). */
const PAGES = JSON.parse(readFileSync('tests/smoke/github-board.json', 'utf8')) as {
  data: { node: { title: string; items: { pageInfo: { endCursor: string | null } } } };
}[];

interface Answer {
  status: number;
  type: string | undefined;
  body: unknown;
}

/** Sends one request through the stand-in, its body in two pieces, and waits for its answer. */
function send(method: string, url: string | undefined, init: { body?: unknown; authorization?: string } = {}): Promise<Answer> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = init.authorization === undefined ? {} : { authorization: init.authorization };
    const request = Object.assign(new EventEmitter(), { method, url, headers }) as unknown as IncomingMessage;
    let status = 0;
    let type: string | undefined;
    const response = {
      writeHead(code: number, written: Record<string, string>) {
        status = code;
        type = written['content-type'];
      },
      end(text: string) {
        resolve({ status, type, body: JSON.parse(text) as unknown });
      },
    } as unknown as ServerResponse;
    handler?.(request, response);
    if (init.body !== undefined) {
      const text = Buffer.from(JSON.stringify(init.body));
      request.emit('data', text.subarray(0, 5));
      request.emit('data', text.subarray(5));
      request.emit('end');
    }
  });
}

const read = (endCursor: string | null) => ({ query: 'query', variables: { id: 'PVT_kwDOEOcG584BpkXr', endCursor } });

describe('the CI stand-in for GitHub’s API', () => {
  it('listens on the port it was given, on 127.0.0.1 alone, and answers that it is up', async () => {
    expect(listened).toEqual([[8790, '127.0.0.1']]);
    expect(await send('GET', '/health')).toEqual({ status: 200, type: 'application/json', body: { ok: true } });
  });

  it('gives an installation token to a request carrying the App’s JWT', async () => {
    expect(await send('POST', '/app/installations/184830629/access_tokens', { authorization: 'Bearer a.b.c' })).toEqual({
      status: 201,
      type: 'application/json',
      body: { token: 'ghs_stand-in' },
    });
  });

  it('refuses a token to a request with no JWT, as GitHub does', async () => {
    expect(await send('POST', '/app/installations/184830629/access_tokens')).toEqual({
      status: 401,
      type: 'application/json',
      body: { message: 'Bad credentials' },
    });
  });

  it('answers the board’s first page to a read with no cursor, and the next to its end cursor: one real read of ShyTalk Stories, eleven epics among its issues', async () => {
    expect(PAGES).toHaveLength(2);
    expect(PAGES.map(({ data }) => data.node.title)).toEqual(['ShyTalk Stories', 'ShyTalk Stories']);
    const titles = PAGES.flatMap(({ data }) => (data.node.items as unknown as { nodes: { content: { title: string } }[] }).nodes).map(
      ({ content }) => content.title,
    );
    expect(titles.filter((title) => title.startsWith('Epic:'))).toHaveLength(11);
    expect((await send('POST', '/graphql', { body: read(null) })).body).toEqual(PAGES[0]);
    expect((await send('POST', '/graphql', { body: read(PAGES[0]?.data.node.items.pageInfo.endCursor ?? '') })).body).toEqual(PAGES[1]);
  });

  it('answers GraphQL’s own error for a cursor it never gave', async () => {
    expect(await send('POST', '/graphql', { body: read('nowhere') })).toEqual({
      status: 200,
      type: 'application/json',
      body: { errors: [{ message: 'no page after nowhere' }] },
    });
  });

  it('answers Not Found for any other address, and only POST or GET /health', async () => {
    expect(await send('POST', '/repos/x')).toEqual({ status: 404, type: 'application/json', body: { message: 'Not Found' } });
    expect(await send('GET', '/graphql')).toEqual({ status: 405, type: 'application/json', body: { error: 'POST, or GET /health' } });
    expect(await send('GET', undefined)).toEqual({ status: 405, type: 'application/json', body: { error: 'POST, or GET /health' } });
  });
});
