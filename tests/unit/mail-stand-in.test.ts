import { EventEmitter } from 'node:events';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { describe, it, expect, vi } from 'vitest';

// The stand-in is a script: it reads its port from argv and listens at once. node:http is stood in, so no socket
// opens; the request listener it hands createServer is driven directly.
const listen = vi.fn();
let handler: RequestListener | undefined;
vi.mock('node:http', () => ({
  createServer: (listener: RequestListener) => {
    handler = listener;
    return { listen };
  },
}));
const argv = process.argv;
process.argv = [...argv.slice(0, 2), '8787'];
await import('../smoke/mail-stand-in.ts');
process.argv = argv;
// Read at once: the unit config clears every mock's calls before each test.
const listened = listen.mock.calls.slice();

interface Answer {
  status: number;
  type: string | undefined;
  body: unknown;
}

/** Sends one request through the stand-in and waits for its answer. */
function send(method: string, url: string | undefined, body?: unknown): Promise<Answer> {
  return new Promise((resolve) => {
    const request = Object.assign(new EventEmitter(), { method, url }) as unknown as IncomingMessage;
    let status = 0;
    let type: string | undefined;
    const response = {
      writeHead(code: number, headers: Record<string, string>) {
        status = code;
        type = headers['content-type'];
      },
      end(text: string) {
        resolve({ status, type, body: JSON.parse(text) as unknown });
      },
    } as unknown as ServerResponse;
    handler?.(request, response);
    if (body !== undefined) {
      const text = Buffer.from(JSON.stringify(body));
      request.emit('data', text.subarray(0, 5));
      request.emit('data', text.subarray(5));
      request.emit('end');
    }
  });
}

const mail = (to: string[], subject: string) => ({
  recipients: { to: to.map((email) => ({ email })) },
  subject,
  bodyText: `${subject} body`,
});

describe('the CI mail stand-in', () => {
  it('listens on the port it was given, on 127.0.0.1 alone', () => {
    expect(listened).toEqual([[8787, '127.0.0.1']]);
  });

  it('answers its health check', async () => {
    expect(await send('GET', '/health')).toEqual({ status: 200, type: 'application/json', body: { ok: true } });
  });

  it('has no mail for an address nothing was sent to, nor for a request naming none', async () => {
    const none = { status: 404, type: 'application/json', body: { error: 'no mail for that address' } };
    expect(await send('GET', '/mail?to=nobody%40example.test')).toEqual(none);
    expect(await send('GET', '/mail')).toEqual(none);
  });

  it('takes a submitted mail as Oracle would, and hands back the latest one per recipient', async () => {
    expect(await send('POST', '/20220926/actions/submitEmail', mail(['ana@example.test', 'ben@example.test'], 'first'))).toEqual({
      status: 200,
      type: 'application/json',
      body: { messageId: 'stand-in', envelopeId: 'stand-in', suppressedRecipients: [] },
    });
    await send('POST', '/20220926/actions/submitEmail', mail(['ana@example.test'], 'second'));
    expect(await send('GET', '/mail?to=ana%40example.test')).toEqual({
      status: 200,
      type: 'application/json',
      body: mail(['ana@example.test'], 'second'),
    });
    expect((await send('GET', '/mail?to=ben%40example.test')).body).toEqual(mail(['ana@example.test', 'ben@example.test'], 'first'));
  });

  it('refuses every other method, and a GET of any other path, with 405', async () => {
    const refused = { status: 405, type: 'application/json', body: { error: 'POST or the GETs only' } };
    expect(await send('PUT', '/mail')).toEqual(refused);
    expect(await send('GET', '/other')).toEqual(refused);
    expect(await send('GET', undefined)).toEqual(refused);
  });
});
