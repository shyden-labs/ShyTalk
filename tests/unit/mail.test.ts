import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { mailEndpoint, sendMail, type MailEnv } from '../../workers/web/src/mail.ts';
import { AUDIT_SQL } from '../../workers/web/src/audit.ts';
import { SIGNED_HEADERS } from '../../packages/mail/sign.ts';

/**
 * `sendMail` (shyden-labs/ShyTalk#88): one signed SubmitEmail POST to Oracle
 * Email Delivery in this environment's region, as this environment's sender.
 * Every call writes one audit row holding neither the address, nor the
 * subject, nor the body. Oracle, the clock and D1 are stood in.
 */

const MESSAGE = { to: 'member@example.test', subject: 'Your ShyTalk code', text: 'Your code is 482913.' };
const NOW = new Date('2026-11-08T09:30:00Z');
const clock = (): Date => NOW;

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

let pkcs8: string;
let pkcs1: string;

beforeAll(() => {
  pkcs8 = generateKeyPairSync('rsa', {
    // 1024 bits: the signature path is the same, and making a key takes
    // 10-40 ms where 2048 bits took up to 1,032 ms (measured 2026-11-08),
    // past the 1 s hook limit.
    modulusLength: 1024,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
  pkcs1 = createPrivateKey(pkcs8).export({ type: 'pkcs1', format: 'pem' });
});

function environment(overrides: Partial<MailEnv> = {}, failAudit = false): { env: MailEnv; rows: Recorded[] } {
  const { DB, rows } = recordingDb(failAudit);
  return {
    rows,
    env: {
      ENVIRONMENT_NAME: 'dev',
      DB,
      MAIL_REGION: 'uk-london-1',
      MAIL_FROM: 'no-reply@sender.example.test',
      OCI_TENANCY: 'ocid1.tenancy.oc1..t',
      OCI_USER: 'ocid1.user.oc1..u',
      OCI_FINGERPRINT: 'aa:bb',
      OCI_PRIVATE_KEY: pkcs8,
      OCI_COMPARTMENT: 'ocid1.compartment.oc1..c',
      ...overrides,
    },
  };
}

function oracle(response: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const stand = vi.fn(response);
  vi.stubGlobal('fetch', stand);
  return stand;
}

const accepted = (): Promise<Response> => Promise.resolve(Response.json({ messageId: 'm-1', envelopeId: 'e-1', suppressedRecipients: [] }));

const sentRequest = (stand: ReturnType<typeof vi.fn>): Request => stand.mock.calls[0]?.[0] as Request;

const detail = (row: Recorded | undefined): unknown => JSON.parse(row?.values[4] as string);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mailEndpoint', () => {
  it("is the region's SubmitEmail address", () => {
    expect(mailEndpoint('ap-singapore-1').href).toBe(
      'https://cell0.submit.email.ap-singapore-1.oci.oraclecloud.com/20220926/actions/submitEmail',
    );
  });
});

describe('the CI smoke’s stand-in for Oracle (MAIL_ENDPOINT)', () => {
  const STAND_IN = 'http://127.0.0.1:8788/submit';

  it.each(['dev', 'test'] as const)('%s posts to it when it is set', async (name) => {
    const stand = oracle(accepted);
    await sendMail(environment({ ENVIRONMENT_NAME: name, MAIL_ENDPOINT: STAND_IN }).env, MESSAGE, clock);
    expect(sentRequest(stand).url).toBe(STAND_IN);
  });

  it('prod ignores it, so mail can never be turned aside on the live site', async () => {
    const stand = oracle(accepted);
    await sendMail(environment({ ENVIRONMENT_NAME: 'prod', MAIL_ENDPOINT: STAND_IN }).env, MESSAGE, clock);
    expect(sentRequest(stand).url).toBe(mailEndpoint('uk-london-1').href);
  });
});

describe('sendMail', () => {
  it("posts the SubmitEmail body once to the region's endpoint", async () => {
    const stand = oracle(accepted);
    await sendMail(environment().env, MESSAGE, clock);
    expect(stand).toHaveBeenCalledOnce();
    const request = sentRequest(stand);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(mailEndpoint('uk-london-1').href);
    expect(await request.json()).toEqual({
      sender: { senderAddress: { email: 'no-reply@sender.example.test', name: 'ShyTalk' }, compartmentId: 'ocid1.compartment.oc1..c' },
      recipients: { to: [{ email: MESSAGE.to }] },
      subject: MESSAGE.subject,
      bodyText: MESSAGE.text,
    });
  });

  it('sends the html body when there is one', async () => {
    const stand = oracle(accepted);
    await sendMail(environment().env, { ...MESSAGE, html: '<p>Code</p>' }, clock);
    expect(((await sentRequest(stand).json()) as Record<string, unknown>)['bodyHtml']).toBe('<p>Code</p>');
  });

  it("signs the request with this environment's key", async () => {
    const stand = oracle(accepted);
    await sendMail(environment().env, MESSAGE, clock);
    const headers = sentRequest(stand).headers;
    expect(headers.get('date')).toBe('Sun, 08 Nov 2026 09:30:00 GMT');
    for (const name of SIGNED_HEADERS.slice(2)) expect(headers.get(name)).not.toBeNull();
    expect(headers.get('authorization')).toContain('keyId="ocid1.tenancy.oc1..t/ocid1.user.oc1..u/aa:bb"');
  });

  it('answers the message id and audits mail.sent', async () => {
    oracle(accepted);
    const { env, rows } = environment();
    expect(await sendMail(env, MESSAGE, clock)).toEqual({ ok: true, messageId: 'm-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sql).toBe(AUDIT_SQL);
    expect(rows[0]?.values.slice(1, 3)).toEqual(['system', 'mail.sent']);
    expect(detail(rows[0])).toEqual({ messageId: 'm-1' });
  });

  it('names a refused sender and audits its status and code', async () => {
    oracle(() => Promise.resolve(Response.json({ code: 'NotAuthorizedOrNotFound', message: `no ${MESSAGE.to}` }, { status: 404 })));
    const { env, rows } = environment();
    expect(await sendMail(env, MESSAGE, clock)).toEqual({
      ok: false,
      reason: 'sender-not-approved',
      status: 404,
      error: 'NotAuthorizedOrNotFound',
    });
    expect(rows[0]?.values[2]).toBe('mail.failed');
    expect(detail(rows[0])).toEqual({ reason: 'sender-not-approved', status: 404, error: 'NotAuthorizedOrNotFound' });
  });

  it('answers unavailable when Oracle cannot be reached', async () => {
    oracle(() => Promise.reject(new TypeError('network')));
    expect(await sendMail(environment().env, MESSAGE, clock)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers unavailable for a 503 page that is not JSON', async () => {
    oracle(() => Promise.resolve(new Response('<html>down</html>', { status: 503 })));
    expect(await sendMail(environment().env, MESSAGE, clock)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('answers unavailable for a 200 that is not an Oracle answer', async () => {
    oracle(() => Promise.resolve(Response.json({})));
    expect(await sendMail(environment().env, MESSAGE, clock)).toEqual({ ok: false, reason: 'unavailable', status: 200 });
  });

  it.each(['MAIL_REGION', 'MAIL_FROM', 'OCI_TENANCY', 'OCI_USER', 'OCI_FINGERPRINT', 'OCI_PRIVATE_KEY', 'OCI_COMPARTMENT'] as const)(
    'answers unavailable without %s, sending nothing',
    async (name) => {
      const stand = oracle(accepted);
      const { env, rows } = environment({ [name]: undefined });
      expect(await sendMail(env, MESSAGE, clock)).toEqual({ ok: false, reason: 'unavailable' });
      expect(stand).not.toHaveBeenCalled();
      expect(detail(rows[0])).toEqual({ reason: 'unavailable' });
    },
  );

  it('answers unavailable for a key that is not PKCS#8, sending nothing', async () => {
    const stand = oracle(accepted);
    expect(await sendMail(environment({ OCI_PRIVATE_KEY: pkcs1 }).env, MESSAGE, clock)).toEqual({ ok: false, reason: 'unavailable' });
    expect(stand).not.toHaveBeenCalled();
  });

  it('refuses a malformed message without sending, and audits it', async () => {
    const stand = oracle(accepted);
    const { env, rows } = environment();
    expect(await sendMail(env, { ...MESSAGE, subject: 'a\nBcc: x@y.test' }, clock)).toEqual({ ok: false, reason: 'invalid' });
    expect(stand).not.toHaveBeenCalled();
    expect(rows[0]?.values[2]).toBe('mail.failed');
    expect(detail(rows[0])).toEqual({ reason: 'invalid' });
  });

  it('uses the real clock when given none', async () => {
    const stand = oracle(accepted);
    await sendMail(environment().env, MESSAGE);
    const sent = Date.parse(sentRequest(stand).headers.get('date') as string);
    expect(Math.abs(sent - Date.now())).toBeLessThan(5_000);
  });

  it('never puts the recipient, subject or body in the audit row', async () => {
    oracle(() => Promise.resolve(Response.json({ code: 'InvalidParameter', message: MESSAGE.to }, { status: 400 })));
    const { env, rows } = environment();
    await sendMail(env, { ...MESSAGE, html: '<p>482913</p>' }, clock);
    oracle(accepted);
    await sendMail(env, MESSAGE, clock);
    const stored = JSON.stringify(rows.map((row) => row.values));
    for (const secret of [MESSAGE.to, MESSAGE.subject, MESSAGE.text, '482913']) expect(stored).not.toContain(secret);
  });

  it('logs nothing holding the address, subject or body', async () => {
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    }
    for (const answer of [
      accepted,
      () => Promise.reject(new TypeError(MESSAGE.to)),
      () => Promise.resolve(new Response('x', { status: 500 })),
    ]) {
      oracle(answer);
      await sendMail(environment().env, MESSAGE, clock);
    }
    await sendMail(environment().env, { ...MESSAGE, to: 'bad' }, clock);
    for (const line of lines) for (const secret of [MESSAGE.to, MESSAGE.subject, MESSAGE.text]) expect(line).not.toContain(secret);
  });

  it('rejects when the audit row cannot be written', async () => {
    oracle(accepted);
    await expect(sendMail(environment({}, true).env, MESSAGE, clock)).rejects.toThrow('D1 down');
  });
});
