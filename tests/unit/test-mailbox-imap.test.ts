import { afterEach, describe, it, expect, vi } from 'vitest';

// The real IMAP reader behind waitForAnyMail, with imapflow stood in: each test sets what the server holds.
interface Held {
  folders: string[];
  exists: number;
  head: false | { envelope?: { subject?: string } };
  content: string[] | undefined;
}
let held: Held;
const made: { options: unknown; calls: string[] }[] = [];
vi.mock('imapflow', () => ({
  ImapFlow: class {
    calls: string[] = [];
    constructor(options: unknown) {
      made.push({ options, calls: this.calls });
    }
    connect() {
      this.calls.push('connect');
      return Promise.resolve();
    }
    list() {
      return Promise.resolve(held.folders.map((path) => ({ path })));
    }
    mailboxOpen(folder: string, options: unknown) {
      this.calls.push(`open ${folder} ${JSON.stringify(options)}`);
      return Promise.resolve({ exists: held.exists });
    }
    fetchOne(range: string, query: unknown) {
      this.calls.push(`fetchOne ${range} ${JSON.stringify(query)}`);
      return Promise.resolve(held.head);
    }
    download(range: string, part: string) {
      this.calls.push(`download ${range} ${part}`);
      return Promise.resolve({
        // The body in chunks; `for await` reads an array of them as it reads the real stream.
        content: held.content?.map((text) => Buffer.from(text)),
      });
    }
    logout() {
      this.calls.push('logout');
      return Promise.resolve();
    }
  },
}));
const { waitForAnyMail } = await import('../phones/test-mailbox.ts');

const full: Held = {
  folders: ['INBOX', 'INBOX.t1'],
  exists: 2,
  head: { envelope: { subject: 'Hello' } },
  content: ['Line one\n', 'Grüße, 你好'],
};

afterEach(() => {
  made.length = 0;
  vi.useRealTimers();
});

describe('the real test-mailbox reader', () => {
  it('signs in to the mailbox over TLS on 993 with the password, and reads the newest mail in the tag folder whole', async () => {
    held = full;
    expect(await waitForAnyMail('t1', { password: 'secret' })).toEqual({ subject: 'Hello', text: 'Line one\nGrüße, 你好' });
    expect(made).toEqual([
      {
        options: {
          host: 'mail.shyden.co.uk',
          port: 993,
          secure: true,
          auth: { user: 'shytalk-tests@shyden.co.uk', pass: 'secret' },
          logger: false,
        },
        calls: ['connect', 'open INBOX.t1 {"readOnly":true}', 'fetchOne * {"envelope":true}', 'download * 1', 'logout'],
      },
    ]);
  });

  it('gives an empty subject when the envelope names none', async () => {
    held = { ...full, head: {} };
    expect((await waitForAnyMail('t1', { password: 'p' })).subject).toBe('');
  });

  it.each<[string, Partial<Held>]>([
    ['the tag folder does not exist yet', { folders: ['INBOX'] }],
    ['the folder is empty', { exists: 0 }],
    ['the newest mail cannot be fetched', { head: false }],
    ['the newest mail has no body', { content: undefined }],
  ])('looks again 5 s later, on the clock, when %s', async (_, missing) => {
    vi.useFakeTimers();
    held = { ...full, ...missing };
    const mail = waitForAnyMail('t1', { password: 'p' });
    await vi.advanceTimersByTimeAsync(4_999);
    held = full;
    expect(made[0]?.calls).not.toContain('logout');
    await vi.advanceTimersByTimeAsync(1);
    expect(await mail).toEqual({ subject: 'Hello', text: 'Line one\nGrüße, 你好' });
  });

  it('gives up on the clock at the 120 s ceiling when no mail ever comes, and signs out', async () => {
    vi.useFakeTimers();
    held = { ...full, folders: [] };
    const mail = waitForAnyMail('t1', { password: 'p' });
    const refused = expect(mail).rejects.toThrow('no mail reached INBOX.t1 within 120 s');
    await vi.advanceTimersByTimeAsync(120_000);
    await refused;
    expect(made[0]?.calls.at(-1)).toBe('logout');
  });
});
