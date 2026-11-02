import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, countDoors, judge, main, type Fetch } from '../../scripts/door-count.ts';

/**
 * The daily door count (decision 197; plan 2 Task E6 Step 5,
 * shyden-labs/ShyTalk#31): each door's requests over the past day, read from
 * Cloudflare's GraphQL analytics, judged against its limit. Cloudflare is
 * stood in; nothing leaves the test.
 */

const NOW = new Date('2026-11-02T01:00:00Z');
const ACCOUNT = 'acc0unt';

/** A stand-in GraphQL endpoint answering `body` with `status`, recording each request. */
function graphql(body: unknown, status = 200): { fetch: Fetch; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  return {
    requests,
    fetch: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    },
  };
}

const answer = (rows: { scriptName: string; requests: number }[]) => ({
  data: {
    viewer: {
      accounts: [
        { workersInvocationsAdaptive: rows.map(({ scriptName, requests }) => ({ sum: { requests }, dimensions: { scriptName } })) },
      ],
    },
  },
  errors: null,
});

describe('the limits', () => {
  it('are TEST 20,000 and DEV 10,000 requests a day (decision 197)', () => {
    expect(LIMITS).toEqual({ 'shytalk-door-test': 20_000, 'shytalk-door-dev': 10_000 });
  });
});

describe('countDoors', () => {
  it('asks for the past 24 hours on the account, with the token', async () => {
    const stand = graphql(answer([]));
    await countDoors(stand.fetch, 'tok', ACCOUNT, NOW);
    expect(stand.requests).toHaveLength(1);
    const { url, init } = stand.requests[0] as { url: string; init: RequestInit };
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    const sent = JSON.parse(init.body as string) as { variables: unknown; query: string };
    expect(sent.variables).toEqual({ accountTag: ACCOUNT, since: '2026-11-01T01:00:00.000Z', until: '2026-11-02T01:00:00.000Z' });
    expect(sent.query).toContain('workersInvocationsAdaptive');
  });

  it('sums each door, adding rows of the same script, and counts a silent door as 0', async () => {
    const stand = graphql(
      answer([
        { scriptName: 'shytalk-door-test', requests: 5 },
        { scriptName: 'shytalk-door-test', requests: 7 },
        { scriptName: 'some-other-worker', requests: 99 },
      ]),
    );
    expect(await countDoors(stand.fetch, 'tok', ACCOUNT, NOW)).toEqual({ 'shytalk-door-test': 12, 'shytalk-door-dev': 0 });
  });

  it('throws naming the status when Cloudflare refuses', async () => {
    await expect(countDoors(graphql({}, 403).fetch, 'tok', ACCOUNT, NOW)).rejects.toThrow('Cloudflare analytics answered 403');
  });

  it('throws naming the first GraphQL error', async () => {
    await expect(countDoors(graphql({ data: null, errors: [{ message: 'not authorized' }] }).fetch, 'tok', ACCOUNT, NOW)).rejects.toThrow(
      'Cloudflare analytics refused the query: not authorized',
    );
  });

  it('throws when the account is not in the answer', async () => {
    await expect(countDoors(graphql({ data: { viewer: { accounts: [] } }, errors: null }).fetch, 'tok', ACCOUNT, NOW)).rejects.toThrow(
      'Cloudflare analytics returned no account acc0unt',
    );
  });
});

describe('judge', () => {
  it('passes doors at or under their limits, with one line each', () => {
    expect(judge({ 'shytalk-door-test': 20_000, 'shytalk-door-dev': 3 })).toEqual({
      ok: true,
      lines: [
        'shytalk-door-test: 20000 requests in the past day (limit 20000)',
        'shytalk-door-dev: 3 requests in the past day (limit 10000)',
      ],
    });
  });

  it('fails a door over its limit, saying so on its line', () => {
    const result = judge({ 'shytalk-door-test': 0, 'shytalk-door-dev': 10_001 });
    expect(result.ok).toBe(false);
    expect(result.lines[1]).toBe('shytalk-door-dev: 10001 requests in the past day (limit 10000): OVER THE LIMIT');
  });
});

describe('main', () => {
  const env = (extra: Record<string, string> = {}) => ({ CLOUDFLARE_ANALYTICS_TOKEN: 'tok', CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ...extra });

  it('returns 0 and writes each line when both doors are under their limits', async () => {
    const out: string[] = [];
    const code = await main([], env(), graphql(answer([{ scriptName: 'shytalk-door-dev', requests: 4 }])).fetch, NOW, (line) =>
      out.push(line),
    );
    expect(code).toBe(0);
    expect(out).toEqual([
      'shytalk-door-test: 0 requests in the past day (limit 20000)',
      'shytalk-door-dev: 4 requests in the past day (limit 10000)',
    ]);
  });

  it('refuses arguments, naming its usage', async () => {
    await expect(main(['extra'], env(), graphql(answer([])).fetch, NOW, () => undefined)).rejects.toThrow(
      'usage: node scripts/door-count.ts (no arguments)',
    );
  });

  it('returns 1 when a door is over its limit', async () => {
    const stand = graphql(answer([{ scriptName: 'shytalk-door-test', requests: 20_001 }]));
    expect(await main([], env(), stand.fetch, NOW, () => undefined)).toBe(1);
  });

  it('returns 1 and names the failure when the read fails', async () => {
    const out: string[] = [];
    expect(await main([], env(), graphql({}, 500).fetch, NOW, (line) => out.push(line))).toBe(1);
    expect(out).toEqual(['the door count could not be read: Cloudflare analytics answered 500']);
  });

  it.each(['CLOUDFLARE_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])('returns 1 naming %s when it is empty', async (name) => {
    const out: string[] = [];
    expect(await main([], env({ [name]: '' }), graphql(answer([])).fetch, NOW, (line) => out.push(line))).toBe(1);
    expect(out).toEqual([`the door count could not be read: ${name} is empty`]);
  });

  describe('with its defaults', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("sends through the runtime's fetch and writes each line to stdout and the job summary", async () => {
      const dir = mkdtempSync(join(tmpdir(), 'door-count-'));
      const summary = join(dir, 'summary.md');
      vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
      vi.stubGlobal('fetch', graphql(answer([{ scriptName: 'shytalk-door-dev', requests: 2 }])).fetch);
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      try {
        expect(await main([], env())).toBe(0);
        expect(stdout).toHaveBeenCalledWith('door-count: shytalk-door-dev: 2 requests in the past day (limit 10000)\n');
        expect(readFileSync(summary, 'utf8')).toBe(
          '- shytalk-door-test: 0 requests in the past day (limit 20000)\n- shytalk-door-dev: 2 requests in the past day (limit 10000)\n',
        );
      } finally {
        rmSync(dir, { recursive: true });
      }
    });

    it('writes only to stdout outside a job', async () => {
      vi.stubEnv('GITHUB_STEP_SUMMARY', '');
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      expect(await main([], {})).toBe(1);
      expect(stdout).toHaveBeenCalledWith('door-count: the door count could not be read: CLOUDFLARE_ANALYTICS_TOKEN is empty\n');
    });
  });
});
