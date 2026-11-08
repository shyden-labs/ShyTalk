import { describe, it, expect, vi, afterEach } from 'vitest';
import { DOOR_MAIL_FROM, handleMail, type DoorMailEnv } from '../../workers/door/src/mail.ts';
import { DOOR_MAIL_PATH, MAIL_MAX_BYTES, MAIL_SECRET_HEADER, type EmailSender } from '../../packages/mail/index.ts';

/**
 * The door's mail route (shyden-labs/ShyTalk#88): dev and test send through
 * the PROD-account door, whose binding may send only as the dev sender
 * (`DOOR_MAIL_FROM`, pinned in door-config.test.ts).
 * Only a request carrying that environment's mail secret sends. The binding
 * and every fetch are stood in.
 */

const MESSAGE = { to: 'member@example.test', subject: 'Your ShyTalk code', text: 'Your code is 482913.' };

type Sent = Parameters<EmailSender['send']>[0];

function recordingSender(outcome: () => Promise<{ messageId: string }> = () => Promise.resolve({ messageId: 'm-1' })): {
  sender: EmailSender;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    sender: {
      send: (message) => {
        sent.push(message);
        return outcome();
      },
    },
  };
}

const env = (sender: EmailSender, secret = 'the-mail-secret'): DoorMailEnv => ({ EMAIL: sender, MAIL_SECRET: secret });

function mailRequest(body: unknown, secret: string | null = 'the-mail-secret', method = 'POST'): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secret !== null) headers.set(MAIL_SECRET_HEADER, secret);
  return new Request(`https://dev.example.test${DOOR_MAIL_PATH}`, {
    method,
    headers,
    body: method === 'GET' ? null : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('door mail: sends', () => {
  it('sends the message as the dev sender and answers its id', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest(MESSAGE), env(sender));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ ok: true, messageId: 'm-1' });
    expect(sent).toEqual([{ ...MESSAGE, from: DOOR_MAIL_FROM }]);
  });

  it('keeps the html part', async () => {
    const { sender, sent } = recordingSender();
    await handleMail(mailRequest({ ...MESSAGE, html: '<p>482913</p>' }), env(sender));
    expect(sent[0]?.html).toBe('<p>482913</p>');
  });

  it('ignores a sender the caller names', async () => {
    const { sender, sent } = recordingSender();
    await handleMail(mailRequest({ ...MESSAGE, from: 'boss@shytalk.app' }), env(sender));
    expect(sent[0]?.from).toBe(DOOR_MAIL_FROM);
  });

  it('answers a send failure with its reason, as a 502', async () => {
    const { sender } = recordingSender(() => Promise.reject(Object.assign(new Error('x'), { code: 'E_DAILY_LIMIT_EXCEEDED' })));
    const answer = await handleMail(mailRequest(MESSAGE), env(sender));
    expect(answer.status).toBe(502);
    expect(await answer.json()).toEqual({ ok: false, reason: 'daily-limit', error: 'E_DAILY_LIMIT_EXCEEDED' });
  });
});

describe('door mail: refuses', () => {
  it('a method other than POST, with a 405', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest(null, 'the-mail-secret', 'GET'), env(sender));
    expect(answer.status).toBe(405);
    expect(sent).toEqual([]);
  });

  it('a missing secret, with a 403', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest(MESSAGE, null), env(sender));
    expect(answer.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('a wrong secret, with a 403', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest(MESSAGE, 'not-it'), env(sender));
    expect(answer.status).toBe(403);
    expect(sent).toEqual([]);
  });

  it('any request when the door has no mail secret, with a 503', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest(MESSAGE, ''), { EMAIL: sender });
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ ok: false, reason: 'unavailable' });
    expect(sent).toEqual([]);
  });

  it('any request when the door has no binding, with a 503', async () => {
    const answer = await handleMail(mailRequest(MESSAGE), { MAIL_SECRET: 'the-mail-secret' });
    expect(answer.status).toBe(503);
    expect(await answer.json()).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a body that is not JSON, with a 400', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest('{not json'), env(sender));
    expect(answer.status).toBe(400);
    expect(await answer.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(sent).toEqual([]);
  });

  it('a message the check refuses, with a 400', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest({ ...MESSAGE, subject: 'Hi\nBcc: x@y.test' }), env(sender));
    expect(answer.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it('a body over the size limit, with a 413', async () => {
    const { sender, sent } = recordingSender();
    const answer = await handleMail(mailRequest({ ...MESSAGE, text: 'x'.repeat(MAIL_MAX_BYTES + 1) }), env(sender));
    expect(answer.status).toBe(413);
    expect(await answer.json()).toEqual({ ok: false, reason: 'invalid' });
    expect(sent).toEqual([]);
  });

  it('a declared length over the size limit, with a 413, before reading the body', async () => {
    const { sender, sent } = recordingSender();
    const request = mailRequest(MESSAGE);
    const lying = new Request(request, { headers: new Headers([...request.headers, ['content-length', String(MAIL_MAX_BYTES + 1)]]) });
    const answer = await handleMail(lying, env(sender));
    expect(answer.status).toBe(413);
    expect(lying.bodyUsed).toBe(false);
    expect(sent).toEqual([]);
  });

  it('never forwards a refused request to the origin', async () => {
    const origin = vi.fn();
    vi.stubGlobal('fetch', origin);
    const { sender } = recordingSender();
    await handleMail(mailRequest(MESSAGE, 'not-it'), env(sender));
    await handleMail(mailRequest(MESSAGE, ''), { EMAIL: sender });
    expect(origin).not.toHaveBeenCalled();
  });
});

describe('door mail: logs nothing of the message', () => {
  it('holds no address, subject or text in any console line, sent or failed', async () => {
    const lines: unknown[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args));
    }
    await handleMail(mailRequest(MESSAGE), env(recordingSender().sender));
    await handleMail(
      mailRequest(MESSAGE),
      env(recordingSender(() => Promise.reject(new Error(`to ${MESSAGE.to}: ${MESSAGE.text}`))).sender),
    );
    const logged = JSON.stringify(lines);
    for (const part of [MESSAGE.to, MESSAGE.subject, MESSAGE.text]) expect(logged).not.toContain(part);
  });
});
