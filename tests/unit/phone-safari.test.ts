import { describe, it, expect, vi } from 'vitest';
import { safariPage, type WebDriverCall } from '../phones/safari.ts';

/**
 * Safari on the iPhone Air, driven through Appium's WebDriver API
 * (shyden-labs/ShyTalk#112). Measured 2026-11-06: Safari reports no
 * `responseStatus`, so a page's status comes from Appium's `safariNetwork`
 * log (`Network.responseReceived`, `event.type` "Document"), and CSP refusals
 * from its `safariConsole` log. Appium is stood in here.
 */

const BASE = 'https://site.example';

/** One `safariNetwork` entry, as Appium returns it: the event JSON in `message`. */
const network = (url: string, status: number, type = 'Document') => ({
  message: JSON.stringify({ method: 'Network.responseReceived', event: { type, response: { url, status } } }),
});
/** One `safariConsole` entry. */
const consoleLine = (source: string, text: string) => ({ message: JSON.stringify({ source, level: 'error', text }) });

interface Fake {
  call: WebDriverCall;
  calls: [string, string, unknown][];
}

/** Appium with queued log answers: each log read takes the next answer for its type, else nothing. */
function appium(logs: Record<string, unknown[][]> = {}, executes: unknown[] = []): Fake {
  const calls: [string, string, unknown][] = [];
  const call: WebDriverCall = (method, path, body) => {
    calls.push([method, path, body]);
    if (path.endsWith('/se/log')) return Promise.resolve(logs[(body as { type: string }).type]?.shift() ?? []);
    if (path.includes('/execute/')) return Promise.resolve(executes.shift() ?? null);
    return Promise.resolve(null);
  };
  return { call, calls };
}

describe('safariPage: goto', () => {
  it('drains both logs, opens the address on the target, and answers the document’s status', async () => {
    const fake = appium({
      safariNetwork: [[network('old', 200)], [network(`${BASE}/id/`, 404), network(`${BASE}/s.css`, 200, 'StyleSheet')]],
    });
    const page = safariPage(fake.call, 's1', BASE, undefined, () => 'v1');
    await expect(page.goto('/id/')).resolves.toBe(404);
    expect(fake.calls.slice(0, 3)).toEqual([
      ['POST', '/session/s1/se/log', { type: 'safariNetwork' }],
      ['POST', '/session/s1/se/log', { type: 'safariConsole' }],
      ['POST', '/session/s1/url', { url: `${BASE}/id/?phone-smoke=v1` }],
    ]);
  });

  it('adds its token after a query the path already has, so a confirm link keeps its own', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/closed-testing/confirm`, 200)]] });
    const page = safariPage(fake.call, 's1', BASE, undefined, () => 'v1');
    await page.goto('/closed-testing/confirm?t=abc');
    expect(fake.calls[2]).toEqual(['POST', '/session/s1/url', { url: `${BASE}/closed-testing/confirm?t=abc&phone-smoke=v1` }]);
  });

  it('asks for each page fresh, with a token no earlier visit used: Safari answered 304 from its cache across sessions (2026-11-07)', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/`, 200)], [], [network(`${BASE}/`, 200)]] });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await page.goto('/');
    const urls = fake.calls.filter(([, path]) => path.endsWith('/url')).map(([, , body]) => (body as { url: string }).url);
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toMatch(new RegExp(`^${BASE}/\\?phone-smoke=[0-9a-z]+$`));
    expect(new Set(urls).size).toBe(2);
  });

  it('answers the last document when the page loads more than one, and ignores other kinds', async () => {
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/`, 301), network(`${BASE}/en/`, 200), network(`${BASE}/x.js`, 500, 'Script')]],
    });
    await expect(safariPage(fake.call, 's1', BASE).goto('/')).resolves.toBe(200);
  });

  it('reads only responses: a request for the document carries no status', async () => {
    const request = {
      message: JSON.stringify({ method: 'Network.requestWillBeSent', event: { type: 'Document', request: { url: `${BASE}/` } } }),
    };
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/`, 200), request]] });
    await expect(safariPage(fake.call, 's1', BASE).goto('/')).resolves.toBe(200);
  });

  it('fails naming the address when Safari logged no document', async () => {
    const fake = appium({ safariNetwork: [[], [network(`${BASE}/s.css`, 200, 'StyleSheet')]] });
    await expect(safariPage(fake.call, 's1', BASE).goto('/th/')).rejects.toThrow(`Safari logged no document for ${BASE}/th/?phone-smoke=`);
  });
});

describe('safariPage: cspRefusals', () => {
  it('answers the console’s CSP refusals since the last goto, across reads, and nothing else', async () => {
    const refusal =
      'Refused to load https://x/beacon.js because it appears in neither the script-src directive nor the default-src directive of the Content Security Policy.';
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/`, 200)]],
      safariConsole: [
        [consoleLine('security', 'from before')],
        [consoleLine('network', 'Failed to load resource: 404'), consoleLine('security', refusal)],
        [consoleLine('security', 'Content Security Policy: later')],
      ],
    });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await expect(page.cspRefusals()).resolves.toEqual([refusal]);
    await expect(page.cspRefusals()).resolves.toEqual([refusal, 'Content Security Policy: later']);
  });

  it('starts again at each goto', async () => {
    const fake = appium({
      safariNetwork: [[], [network(`${BASE}/`, 200)], [], [network(`${BASE}/`, 200)]],
      safariConsole: [[], [consoleLine('security', 'Refused by the Content Security Policy')], []],
    });
    const page = safariPage(fake.call, 's1', BASE);
    await page.goto('/');
    await page.cspRefusals();
    await page.goto('/');
    await expect(page.cspRefusals()).resolves.toEqual([]);
  });
});

describe('safariPage: reading the page', () => {
  /** The script and arguments of the last execute call. */
  const lastScript = (fake: Fake) =>
    fake.calls.filter(([, path]) => path.endsWith('/execute/sync')).at(-1)?.[2] as { script: string; args: unknown[] };

  it('reads an attribute of the first match, passing the selector and name as arguments', async () => {
    const fake = appium({}, ['en']);
    await expect(safariPage(fake.call, 's1', BASE).attribute('html', 'lang')).resolves.toBe('en');
    expect(lastScript(fake).args).toEqual(['html', 'lang']);
    expect(lastScript(fake).script).toContain('getAttribute');
  });

  it('answers visibility, text and link counts from the page, as their types', async () => {
    const fake = appium({}, [true, 'Learn languages', 2, 1]);
    const page = safariPage(fake.call, 's1', BASE);
    await expect(page.isVisible('nav')).resolves.toBe(true);
    await expect(page.text('h1')).resolves.toBe('Learn languages');
    await expect(page.links('Apply')).resolves.toBe(2);
    expect(lastScript(fake).args).toEqual(['Apply', false]);
    await expect(page.visibleLinks('Apply')).resolves.toBe(1);
    expect(lastScript(fake).args).toEqual(['Apply', true]);
  });

  it('counts the elements a selector matches, as Playwright’s toHaveCount (shyden-labs/ShyTalk#180)', async () => {
    const fake = appium({}, [3]);
    await expect(safariPage(fake.call, 's1', BASE).count('[data-testid="devices"] li')).resolves.toBe(3);
    expect(lastScript(fake).args).toEqual(['[data-testid="devices"] li']);
    expect(lastScript(fake).script).toContain('querySelectorAll(arguments[0]).length');
  });

  it('fails naming the selector when nothing matches it', async () => {
    const page = safariPage(appium({}, [null]).call, 's1', BASE);
    await expect(page.text('h1')).rejects.toThrow('nothing matches h1');
  });

  it('runs axe from axe-core’s own file and answers its violations as id and node count', async () => {
    const read = vi.fn(() => 'window.axe = {};');
    const fake = appium({}, [null, [{ id: 'color-contrast', nodes: 3 }]]);
    await expect(safariPage(fake.call, 's1', BASE, read).axeViolations()).resolves.toEqual(['color-contrast: 3']);
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/axe-core\/axe\.min\.js$/));
    const executes = fake.calls.filter(([, path]) => path.includes('/execute/'));
    expect(executes.map(([, path]) => path)).toEqual(['/session/s1/execute/sync', '/session/s1/execute/async']);
    expect((executes[0]?.[2] as { script: string }).script).toBe('window.axe = {};');
  });

  it('gives axe a minute before running it: Appium’s own script timeout cut it off at 17-29 ms on the iPhone Air (2026-11-07)', async () => {
    const fake = appium({}, [null, []]);
    await safariPage(fake.call, 's1', BASE, () => '').axeViolations();
    const steps = fake.calls.map(([, path]) => path);
    expect(fake.calls).toContainEqual(['POST', '/session/s1/timeouts', { script: 60_000 }]);
    expect(steps.indexOf('/session/s1/timeouts')).toBeLessThan(steps.indexOf('/session/s1/execute/async'));
  });
});

describe('safariPage: tap and waitForText', () => {
  const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

  it('finds the element and clicks it through WebDriver', async () => {
    const calls: [string, string, unknown][] = [];
    const call: WebDriverCall = (method, path, body) => {
      calls.push([method, path, body]);
      return Promise.resolve(path.endsWith('/element') ? { [ELEMENT]: 'e-1' } : null);
    };
    await safariPage(call, 's1', BASE).tap('#confirm-button');
    expect(calls).toEqual([
      ['POST', '/session/s1/element', { using: 'css selector', value: '#confirm-button' }],
      ['POST', '/session/s1/element/e-1/click', {}],
    ]);
  });

  it('types into the element key by key through WebDriver, as the iPhone’s keyboard does', async () => {
    const calls: [string, string, unknown][] = [];
    const call: WebDriverCall = (method, path, body) => {
      calls.push([method, path, body]);
      return Promise.resolve(path.endsWith('/element') ? { [ELEMENT]: 'e-2' } : null);
    };
    await safariPage(call, 's1', BASE).type('#apply-email', 'a+b@mail.test');
    expect(calls).toEqual([
      ['POST', '/session/s1/element', { using: 'css selector', value: '#apply-email' }],
      ['POST', '/session/s1/element/e-2/value', { text: 'a+b@mail.test' }],
    ]);
  });

  it('looks again until the text comes', async () => {
    const fake = appium({}, ['Old', 'New']);
    const waits: number[] = [];
    const page = safariPage(fake.call, 's1', BASE, undefined, undefined, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    });
    await expect(page.waitForText('h1', 'New')).resolves.toBeUndefined();
    expect(waits).toEqual([250]);
  });

  it('fails at its ceiling, naming what it found', async () => {
    const stuck: WebDriverCall = () => Promise.resolve('Old');
    const page = safariPage(stuck, 's1', BASE, undefined, undefined, () => Promise.resolve());
    await expect(page.waitForText('h1', 'New')).rejects.toThrow('h1 held "Old", not "New", after 15000 ms');
  });

  it('waits by the real clock when nothing stands in', async () => {
    const fake = appium({}, ['Old', 'New']);
    await expect(safariPage(fake.call, 's1', BASE).waitForText('h1', 'New')).resolves.toBeUndefined();
  });
});
