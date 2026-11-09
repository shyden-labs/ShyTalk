import { describe, it, expect, vi } from 'vitest';
import { plusAddress, waitForMail, type MailboxReader } from '../phones/test-mailbox.ts';

/**
 * The phones' closed-testing journey reads the real test mailbox
 * (shyden-labs/ShyTalk#150, Shyden 2026-11-10). cPanel files a plus-address
 * mail in its own folder, `INBOX.<tag>` (measured 2026-11-10 on #162), so the
 * reader waits on that folder. The IMAP connection is stood in here.
 */

const MAIL = { subject: 'Confirm your email', text: 'Hello\nhttps://dev.shytalk.app/closed-testing/confirm?t=abc_DEF-1\nBye' };

function reader(answers: ({ subject: string; text: string } | null)[]): MailboxReader & { folders: string[]; closed: number } {
  const folders: string[] = [];
  const state = { folders, closed: 0 };
  return Object.assign(state, {
    latest: vi.fn((folder: string) => {
      folders.push(folder);
      return Promise.resolve(answers.length > 1 ? (answers.shift() ?? null) : (answers[0] ?? null));
    }),
    close: vi.fn(() => {
      state.closed += 1;
      return Promise.resolve();
    }),
  });
}

function clock() {
  let at = 0;
  return { now: () => at, pause: vi.fn((ms: number) => ((at += ms), Promise.resolve())) };
}

describe('plusAddress', () => {
  it('is the test mailbox with the tag after a plus', () => {
    expect(plusAddress('oneplus-1794265761249')).toBe('shytalk-tests+oneplus-1794265761249@shyden.co.uk');
  });

  it.each(['', 'a.b', 'a b', 'A', 'x/y'])('refuses the tag %j, which would not be its own folder', (tag) => {
    expect(() => plusAddress(tag)).toThrow(/tag/);
  });
});

describe('waitForMail', () => {
  it('reads the latest mail in INBOX.<tag> and closes the connection', async () => {
    const box = reader([MAIL]);
    const { now, pause } = clock();
    await expect(waitForMail('iphone-7', { password: 'pw', open: () => Promise.resolve(box), now, pause })).resolves.toEqual({
      ...MAIL,
      confirmLink: 'https://dev.shytalk.app/closed-testing/confirm?t=abc_DEF-1',
    });
    expect(box.folders).toEqual(['INBOX.iphone-7']);
    expect(box.closed).toBe(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('waits 5 s between looks until the mail arrives', async () => {
    const box = reader([null, null, MAIL]);
    const { now, pause } = clock();
    const mail = await waitForMail('t1', { password: 'pw', open: () => Promise.resolve(box), now, pause });
    expect(mail.confirmLink).toContain('t=abc_DEF-1');
    expect(box.folders).toEqual(['INBOX.t1', 'INBOX.t1', 'INBOX.t1']);
    expect(pause.mock.calls).toEqual([[5_000], [5_000]]);
    expect(box.closed).toBe(1);
  });

  it('fails at its 120 s ceiling naming the folder, and still closes', async () => {
    const box = reader([null]);
    const { now, pause } = clock();
    await expect(waitForMail('t2', { password: 'pw', open: () => Promise.resolve(box), now, pause })).rejects.toThrow(
      'no mail reached INBOX.t2 within 120 s',
    );
    expect(box.folders.length).toBe(25);
    expect(box.closed).toBe(1);
  });

  it('fails naming the subject when the mail holds no confirm link', async () => {
    const box = reader([{ subject: 'Something else', text: 'no link here' }]);
    const { now, pause } = clock();
    await expect(waitForMail('t3', { password: 'pw', open: () => Promise.resolve(box), now, pause })).rejects.toThrow(
      'the mail in INBOX.t3 ("Something else") holds no confirm link',
    );
    expect(box.closed).toBe(1);
  });

  it('refuses to start without the password, naming where it comes from', async () => {
    const open = vi.fn();
    await expect(waitForMail('t4', { password: '', open })).rejects.toThrow(
      'TEST_MAILBOX_PASSWORD is unset: the phone run reads it from the Keychain (service shytalk-test-mailbox)',
    );
    expect(open).not.toHaveBeenCalled();
  });
});
