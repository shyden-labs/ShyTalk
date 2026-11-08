import { describe, it, expect, vi, afterEach } from 'vitest';
import { LIVE_MAIL_FROM, sendMail, type MailEnv } from '../../workers/web/src/mail.ts';
import { AUDIT_SQL } from '../../workers/web/src/audit.ts';
import { MAIL_SECRET_HEADER, type EmailSender } from '../../packages/mail/index.ts';

/**
 * `sendMail` (shyden-labs/ShyTalk#88): PROD sends with its own binding as
 * no-reply@shytalk.app; TEST and DEV post to their door's mail route. Every
 * call writes one audit row holding neither the address, nor the subject, nor
 * the body. The binding, the door and D1 are stood in.
 */

const MESSAGE = { to: 'member@example.test', subject: 'Your ShyTalk code', text: 'Your code is 482913.' };

interface Recorded {
  sql: string;
  values: unknown[];
}

function recordingDb(fail = false): { DB: MailEnv['DB']; rows: Recorded[] } {
  const rows: Recorded[] = [];
  return {
    rows,
    DB: {
      prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
      batch: (statements: unknown[]) => {
        if (fail) return Promise.reject(new Error('D1 down'));
        rows.push(...(statements as Recorded[]));
        return Promise.resolve([]);
      },
    },
  };
}

type Sent = Parameters<EmailSender['send']>[0];

function sender(outcome: () => Promise<{ messageId: string }> = () => Promise.resolve({ messageId: 'm-live' })): {
  EMAIL: EmailSender;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    EMAIL: {
      send: (message) => {
        sent.push(message);
        return outcome();
      },
    },
  };
}

const coded = (code: string): Error => Object.assign(new Error(`to ${MESSAGE.to}: ${MESSAGE.text}`), { code });

const detail = (row: Recorded | undefined): unknown => JSON.parse(row?.values[4] as string);

function doorAnswer(response: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const door = vi.fn(response);
  vi.stubGlobal('fetch', door);
  return door;
}

const prodEnv = (EMAIL: EmailSender | undefined, DB: MailEnv['DB']): MailEnv => ({
  ENVIRONMENT_NAME: 'prod',
  SITE_ORIGIN: 'https://shytalk.app',
  EMAIL,
  DB,
});
const devEnv = (DB: MailEnv['DB'], extra: Partial<MailEnv> = {}): MailEnv => ({
  ENVIRONMENT_NAME: 'dev',
  SITE_ORIGIN: 'https://dev.example.test',
  MAIL_SECRET: 'the-mail-secret',
  DB,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendMail on PROD', () => {
  it('sends with the binding as no-reply@shytalk.app', async () => {
    const { DB } = recordingDb();
    const { EMAIL, sent } = sender();
    expect(await sendMail(prodEnv(EMAIL, DB), MESSAGE)).toEqual({ ok: true, messageId: 'm-live' });
    expect(sent).toEqual([{ ...MESSAGE, from: 'no-reply@shytalk.app' }]);
    expect(LIVE_MAIL_FROM).toBe('no-reply@shytalk.app');
  });

  it('answers a thrown code as its reason', async () => {
    const { DB } = recordingDb();
    const { EMAIL } = sender(() => Promise.reject(coded('E_DAILY_LIMIT_EXCEEDED')));
    expect(await sendMail(prodEnv(EMAIL, DB), MESSAGE)).toEqual({ ok: false, reason: 'daily-limit', error: 'E_DAILY_LIMIT_EXCEEDED' });
  });

  it('answers unavailable with no binding', async () => {
    const { DB } = recordingDb();
    const door = doorAnswer(() => Promise.resolve(new Response('x')));
    expect(await sendMail(prodEnv(undefined, DB), MESSAGE)).toEqual({ ok: false, reason: 'unavailable' });
    expect(door).not.toHaveBeenCalled();
  });

  it('never calls the door', async () => {
    const { DB } = recordingDb();
    const door = doorAnswer(() => Promise.resolve(new Response('x')));
    await sendMail(prodEnv(sender().EMAIL, DB), MESSAGE);
    expect(door).not.toHaveBeenCalled();
  });
});

describe('sendMail on TEST and DEV', () => {
  it.each([
    ['dev', 'https://dev.example.test'],
    ['test', 'https://test.example.test'],
  ] as const)('%s posts the message to its own door with the mail secret', async (name, origin) => {
    const { DB } = recordingDb();
    const door = doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm-door' })));
    const result = await sendMail(devEnv(DB, { ENVIRONMENT_NAME: name, SITE_ORIGIN: origin }), MESSAGE);
    expect(result).toEqual({ ok: true, messageId: 'm-door' });
    const request = door.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(`${origin}/__door/mail`);
    expect(request.method).toBe('POST');
    expect(request.headers.get(MAIL_SECRET_HEADER)).toBe('the-mail-secret');
    expect(await request.json()).toEqual(MESSAGE);
  });

  it("returns the door's failure as it is", async () => {
    const { DB } = recordingDb();
    doorAnswer(() => Promise.resolve(Response.json({ ok: false, reason: 'suppressed', error: 'E_RECIPIENT_SUPPRESSED' }, { status: 502 })));
    expect(await sendMail(devEnv(DB), MESSAGE)).toEqual({ ok: false, reason: 'suppressed', error: 'E_RECIPIENT_SUPPRESSED' });
  });

  it('returns a door failure that names no code without one', async () => {
    const { DB } = recordingDb();
    doorAnswer(() => Promise.resolve(Response.json({ ok: false, reason: 'unavailable' }, { status: 503 })));
    expect(await sendMail(devEnv(DB), MESSAGE)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('never touches a binding', async () => {
    const { DB } = recordingDb();
    const { EMAIL, sent } = sender();
    doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm-door' })));
    await sendMail(devEnv(DB, { EMAIL }), MESSAGE);
    expect(sent).toEqual([]);
  });

  it.each([
    ['the door cannot be reached', () => Promise.reject(new TypeError('network'))],
    ['the door answers an HTML 502', () => Promise.resolve(new Response('<h1>Bad Gateway</h1>', { status: 502 }))],
    ['the door answers JSON null', () => Promise.resolve(Response.json(null))],
    ['the door answers an empty object', () => Promise.resolve(Response.json({}))],
    ['the door answers ok with no id', () => Promise.resolve(Response.json({ ok: true }))],
    ['the door answers a reason it does not know', () => Promise.resolve(Response.json({ ok: false, reason: 'made-up' }))],
  ])('answers unavailable when %s', async (_name, answer) => {
    const { DB } = recordingDb();
    doorAnswer(answer);
    expect(await sendMail(devEnv(DB), MESSAGE)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers unavailable with no mail secret, calling no door', async () => {
    const { DB } = recordingDb();
    const door = doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm' })));
    expect(await sendMail(devEnv(DB, { MAIL_SECRET: undefined }), MESSAGE)).toEqual({ ok: false, reason: 'unavailable' });
    expect(door).not.toHaveBeenCalled();
  });

  it('answers unavailable with no site origin, calling no door', async () => {
    const { DB } = recordingDb();
    const door = doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm' })));
    expect(await sendMail(devEnv(DB, { SITE_ORIGIN: undefined }), MESSAGE)).toEqual({ ok: false, reason: 'unavailable' });
    expect(door).not.toHaveBeenCalled();
  });
});

describe('sendMail refuses a malformed message', () => {
  it('answers invalid with no send and no door, on every environment', async () => {
    const door = doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm' })));
    const { EMAIL, sent } = sender();
    const bad = { ...MESSAGE, to: 'a@b.test, c@d.test' };
    expect(await sendMail(prodEnv(EMAIL, recordingDb().DB), bad)).toEqual({ ok: false, reason: 'invalid' });
    expect(await sendMail(devEnv(recordingDb().DB), bad)).toEqual({ ok: false, reason: 'invalid' });
    expect(sent).toEqual([]);
    expect(door).not.toHaveBeenCalled();
  });
});

describe('sendMail audits every call', () => {
  it('writes mail.sent with the message id', async () => {
    const { DB, rows } = recordingDb();
    await sendMail(prodEnv(sender().EMAIL, DB), MESSAGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sql).toBe(AUDIT_SQL);
    expect(rows[0]?.values.slice(1, 4)).toEqual(['system', 'mail.sent', null]);
    expect(detail(rows[0])).toEqual({ messageId: 'm-live' });
    expect(rows[0]?.values[5]).toBe('prod');
  });

  it('writes mail.failed with the reason and the code', async () => {
    const { DB, rows } = recordingDb();
    await sendMail(prodEnv(sender(() => Promise.reject(coded('E_SOMETHING_NEW'))).EMAIL, DB), MESSAGE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values[2]).toBe('mail.failed');
    expect(detail(rows[0])).toEqual({ reason: 'unknown', error: 'E_SOMETHING_NEW' });
  });

  it('writes mail.failed for a refused message', async () => {
    const { DB, rows } = recordingDb();
    await sendMail(devEnv(DB), { ...MESSAGE, text: '' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values[2]).toBe('mail.failed');
    expect(detail(rows[0])).toEqual({ reason: 'invalid' });
  });

  it('never puts the recipient, subject or body in the audit row', async () => {
    const { DB, rows } = recordingDb();
    doorAnswer(() => Promise.resolve(Response.json({ ok: true, messageId: 'm-door' })));
    await sendMail(prodEnv(sender().EMAIL, DB), MESSAGE);
    await sendMail(prodEnv(sender(() => Promise.reject(coded('E_DELIVERY_FAILED'))).EMAIL, DB), MESSAGE);
    await sendMail(devEnv(DB), MESSAGE);
    const stored = JSON.stringify(rows.map((row) => row.values));
    for (const part of [MESSAGE.to, MESSAGE.subject, MESSAGE.text]) expect(stored).not.toContain(part);
  });

  it('rejects when the audit row cannot be written', async () => {
    const { DB } = recordingDb(true);
    await expect(sendMail(prodEnv(sender().EMAIL, DB), MESSAGE)).rejects.toThrow('D1 down');
  });
});

describe('sendMail logs nothing of the message', () => {
  it('holds no address, subject or text in any console line', async () => {
    const lines: unknown[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void lines.push(args));
    }
    await sendMail(prodEnv(sender().EMAIL, recordingDb().DB), MESSAGE);
    await sendMail(prodEnv(sender(() => Promise.reject(coded('E_DELIVERY_FAILED'))).EMAIL, recordingDb().DB), MESSAGE);
    doorAnswer(() => Promise.reject(new TypeError(`network ${MESSAGE.to}`)));
    await sendMail(devEnv(recordingDb().DB), MESSAGE);
    const logged = JSON.stringify(lines);
    for (const part of [MESSAGE.to, MESSAGE.subject, MESSAGE.text]) expect(logged).not.toContain(part);
  });
});
