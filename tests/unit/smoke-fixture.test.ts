import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The smoke suite's `test` (tests/smoke/fixture.ts, shyden-labs/ShyTalk#112):
 * Playwright's own everywhere, except that with `SMOKE_CDP_ENDPOINT` set the
 * browser is Chrome on the OnePlus, reached over adb's DevTools forward. CI
 * never sets it, so CI runs Playwright's `test` untouched. Playwright is stood
 * in; nothing reaches a browser.
 */
const base = vi.hoisted(() => ({ extend: vi.fn((fixtures: unknown) => ({ fixtures })) }));
vi.mock('@playwright/test', () => ({ test: base, expect: vi.fn() }));
const mailbox = vi.hoisted(() => ({
  plusAddress: vi.fn((tag: string) => `box+${tag}@mail.test`),
  waitForMail: vi.fn(() =>
    Promise.resolve({ subject: 'Confirm', text: 'body', confirmLink: 'https://dev.example/closed-testing/confirm?t=abc' }),
  ),
  waitForAnyMail: vi.fn(() => Promise.resolve({ subject: 'Your ShyTalk code', text: '\n402913\n' })),
}));
vi.mock('../phones/test-mailbox.ts', () => mailbox);

/** Typed against the DOM in its own project (tests/smoke/tsconfig.json), so loaded by a path the root check does not follow. */
const FIXTURE: string = '../smoke/fixture.ts';
const load = async () => ((await import(/* @vite-ignore */ FIXTURE)) as { test: unknown }).test;

interface Mailbox {
  address: string;
  mail: () => Promise<{ subject: string; confirmLink: string }>;
  anyMail: () => Promise<{ subject: string; text: string }>;
}
type MailboxFixture = (
  deps: { mailSource: string; request: { get: (url: string) => Promise<{ status: () => number; json: () => Promise<unknown> }> } },
  use: (box: Mailbox) => Promise<void>,
  info: { project: { name: string } },
) => Promise<void>;
type Fixtures = { mailSource: unknown; mailbox: MailboxFixture; browser?: BrowserFixture };

/** The mailbox a test gets, from `source`, with the stand-in answering `answer` to every GET. */
async function mailboxFrom(source: string, answer = { status: 200, body: {} as unknown }) {
  const test = (await load()) as { fixtures: Fixtures };
  const get = vi.fn(() => Promise.resolve({ status: () => answer.status, json: () => Promise.resolve(answer.body) }));
  let given: Mailbox | undefined;
  await test.fixtures.mailbox({ mailSource: source, request: { get } }, (box) => ((given = box), Promise.resolve()), {
    project: { name: 'oneplus' },
  });
  if (given === undefined) throw new Error('the fixture gave no mailbox');
  return { box: given, get };
}

type BrowserFixture = [(deps: { playwright: unknown }, use: (browser: unknown) => Promise<void>) => Promise<void>, { scope: string }];

beforeEach(() => {
  vi.resetModules();
  base.extend.mockClear();
  mailbox.plusAddress.mockClear();
  mailbox.waitForMail.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the smoke suite’s test', () => {
  it('keeps Playwright’s own browser when no DevTools endpoint is set, adding only the mail fixtures', async () => {
    vi.stubEnv('SMOKE_CDP_ENDPOINT', undefined);
    const test = (await load()) as { fixtures: Fixtures };
    expect(base.extend).toHaveBeenCalledOnce();
    expect(Object.keys(test.fixtures)).toEqual(['mailSource', 'mailbox']);
  });

  it('reads mail from the stand-in unless a config sets mailSource, per worker', async () => {
    const test = (await load()) as { fixtures: Fixtures };
    expect(test.fixtures.mailSource).toEqual(['stand-in', { option: true, scope: 'worker' }]);
  });

  it('with an endpoint, takes its one browser, per worker, from Chrome over CDP, and disconnects after', async () => {
    vi.stubEnv('SMOKE_CDP_ENDPOINT', 'http://127.0.0.1:9333');
    const test = (await load()) as { fixtures: { browser: BrowserFixture } };
    expect(base.extend).toHaveBeenCalledOnce();
    expect(Object.keys(test.fixtures)).toEqual(['mailSource', 'mailbox', 'browser']);
    const [fixture, options] = test.fixtures.browser;
    expect(options).toEqual({ scope: 'worker' });

    const order: string[] = [];
    const browser = { close: vi.fn(() => (order.push('close'), Promise.resolve())) };
    const connectOverCDP = vi.fn(() => Promise.resolve(browser));
    await fixture({ playwright: { chromium: { connectOverCDP } } }, (given) => {
      expect(given).toBe(browser);
      order.push('use');
      return Promise.resolve();
    });
    expect(connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9333');
    expect(order).toEqual(['use', 'close']);
  });
});

describe('the mailbox fixture: any mail (shyden-labs/ShyTalk#133)', () => {
  it('from the stand-in, gives the subject and text of the mail to its address', async () => {
    const { box, get } = await mailboxFrom('stand-in', { status: 200, body: { subject: 'Your ShyTalk code', bodyText: '\n402913\n' } });
    expect(await box.anyMail()).toEqual({ subject: 'Your ShyTalk code', text: '\n402913\n' });
    expect(get).toHaveBeenCalledWith(`http://127.0.0.1:8788/mail?to=${encodeURIComponent(box.address)}`);
  });

  it('from the stand-in, fails naming the status when no mail came', async () => {
    const { box } = await mailboxFrom('stand-in', { status: 404, body: {} });
    await expect(box.anyMail()).rejects.toThrow('the stand-in answered 404 for journey-oneplus-1700000000000@example.test');
  });

  it('from IMAP, waits for any mail in its folder with the password from the environment', async () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', 'secret');
    const { box } = await mailboxFrom('imap');
    expect(await box.anyMail()).toEqual({ subject: 'Your ShyTalk code', text: '\n402913\n' });
    expect(mailbox.waitForAnyMail).toHaveBeenCalledWith('oneplus-1700000000000', { password: 'secret' });
  });
});

describe('the mailbox fixture', () => {
  it('from the stand-in, gives an address of its own per project and moment, and its mail by that address', async () => {
    const body = { subject: 'Confirm', bodyText: 'Press https://site.example/closed-testing/confirm?t=x1 now' };
    const { box, get } = await mailboxFrom('stand-in', { status: 200, body });
    expect(box.address).toBe('journey-oneplus-1700000000000@example.test');
    expect(get).not.toHaveBeenCalled();
    expect(await box.mail()).toEqual({ subject: 'Confirm', confirmLink: 'https://site.example/closed-testing/confirm?t=x1' });
    expect(get).toHaveBeenCalledWith(`http://127.0.0.1:8788/mail?to=${encodeURIComponent(box.address)}`);
    expect(mailbox.waitForMail).not.toHaveBeenCalled();
  });

  it('from the stand-in, fails naming the status when no mail came', async () => {
    const { box } = await mailboxFrom('stand-in', { status: 404, body: {} });
    await expect(box.mail()).rejects.toThrow('the stand-in answered 404 for journey-oneplus-1700000000000@example.test');
  });

  it('from the stand-in, fails showing the body when the mail holds no confirm link', async () => {
    const { box } = await mailboxFrom('stand-in', { status: 200, body: { subject: 'Confirm', bodyText: 'no link here' } });
    await expect(box.mail()).rejects.toThrow('the mail holds no confirm link: no link here');
  });

  it('from IMAP, gives the test mailbox’s plus-address and waits for its mail with the password from the environment', async () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', 'secret');
    const { box, get } = await mailboxFrom('imap');
    expect(mailbox.plusAddress).toHaveBeenCalledWith('oneplus-1700000000000');
    expect(box.address).toBe('box+oneplus-1700000000000@mail.test');
    expect(mailbox.waitForMail).not.toHaveBeenCalled();
    expect(await box.mail()).toEqual({ subject: 'Confirm', confirmLink: 'https://dev.example/closed-testing/confirm?t=abc' });
    expect(mailbox.waitForMail).toHaveBeenCalledWith('oneplus-1700000000000', { password: 'secret' });
    expect(get).not.toHaveBeenCalled();
  });

  it('from IMAP with no password set, passes an empty one, which waitForMail refuses by name', async () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', undefined);
    const { box } = await mailboxFrom('imap');
    await box.mail();
    expect(mailbox.waitForMail).toHaveBeenCalledWith('oneplus-1700000000000', { password: '' });
  });
});
