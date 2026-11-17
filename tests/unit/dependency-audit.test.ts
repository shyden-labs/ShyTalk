import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fixCheck, main, unexcused, type AuditException, type AuditReport } from '../../scripts/audit.ts';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

/**
 * CI's dependency audit (shyden-labs/ShyTalk#260): every finding fails it unless it comes wholly from an advisory
 * Shyden excused by name, and an excuse whose advisory is gone fails it too, so it is removed at once. At every
 * session start, `fix-check` says whether an excused advisory now names a fixed release (Shyden 2026-11-18: "every
 * session start needs to check for an update and apply it immediately if so, then remove the exception").
 */

const PICOMATCH = 'GHSA-fc5q-39xc-vjpf';
const EXCUSE: AuditException = {
  advisory: PICOMATCH,
  package: 'picomatch',
  reason: 'no fixed release; reaches build and test tools only',
  ruled: 'Shyden 2026-11-18, shyden-labs/ShyTalk#260',
};
const advisory = (id: string, severity = 'high') => ({ source: 1, url: `https://github.com/advisories/${id}`, severity });

/** An audit as `npm audit --json` writes it: picomatch's own advisory, and packages that depend on it. */
function report(extra: AuditReport['vulnerabilities'] = {}): AuditReport {
  return {
    vulnerabilities: {
      picomatch: { severity: 'high', via: [advisory(PICOMATCH)] },
      tinyglobby: { severity: 'high', via: ['picomatch', 'fdir'] },
      fdir: { severity: 'high', via: ['picomatch'] },
      vite: { severity: 'high', via: ['tinyglobby', 'picomatch'] },
      ...extra,
    },
  };
}

describe('unexcused', () => {
  it('excuses an advisory named in an exception, and every package that is vulnerable only through it', () => {
    expect(unexcused(report(), [EXCUSE])).toEqual([]);
  });

  it('names each finding with no exception, with its advisory', () => {
    expect(unexcused(report(), [])).toEqual([
      `picomatch (high): https://github.com/advisories/${PICOMATCH}`,
      'tinyglobby (high): through picomatch, fdir',
      'fdir (high): through picomatch',
      'vite (high): through tinyglobby, picomatch',
    ]);
  });

  it('keeps a package with its own unexcused advisory, even when it also comes through an excused one', () => {
    expect(unexcused(report({ vite: { severity: 'high', via: ['picomatch', advisory('GHSA-aaaa-bbbb-cccc')] } }), [EXCUSE])).toEqual([
      'vite (high): https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    ]);
  });

  it('keeps a package vulnerable through a package that is not excused', () => {
    expect(
      unexcused(
        report({
          esbuild: { severity: 'moderate', via: [advisory('GHSA-dddd-eeee-ffff', 'moderate')] },
          astro: { severity: 'moderate', via: ['esbuild', 'vite'] },
        }),
        [EXCUSE],
      ),
    ).toEqual(['esbuild (moderate): https://github.com/advisories/GHSA-dddd-eeee-ffff', 'astro (moderate): through esbuild, vite']);
  });

  it('keeps a package vulnerable through one the audit does not list', () => {
    expect(unexcused(report({ astro: { severity: 'high', via: ['missing-package'] } }), [EXCUSE])).toEqual([
      'astro (high): through missing-package',
    ]);
  });

  it('settles packages that depend on each other in a loop', () => {
    expect(
      unexcused({ vulnerabilities: { a: { severity: 'high', via: ['b'] }, b: { severity: 'high', via: ['a', advisory(PICOMATCH)] } } }, [
        EXCUSE,
      ]),
    ).toEqual([]);
  });

  it('leaves out info findings, as --audit-level=low did', () => {
    expect(unexcused(report({ x: { severity: 'info', via: [advisory('GHSA-1111-2222-3333', 'info')] } }), [EXCUSE])).toEqual([]);
  });

  it('fails an exception whose advisory the audit no longer reports, so it is removed', () => {
    expect(unexcused({ vulnerabilities: {} }, [EXCUSE])).toEqual([
      `${PICOMATCH} is excused but no longer reported: delete it from audit-exceptions.json`,
    ]);
  });
});

describe('main', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const audited = (stdout: string, status = 1) =>
    vi.mocked(spawnSync).mockReturnValue({ status, stdout, stderr: '', pid: 1, output: [], signal: null });

  it('runs npm audit as JSON and passes when every finding is excused, saying which advisories it excused', () => {
    audited(JSON.stringify(report()));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([])).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(log).toHaveBeenCalledWith(
      `audit: no unexcused finding; excused ${PICOMATCH} (picomatch): Shyden 2026-11-18, shyden-labs/ShyTalk#260`,
    );
  });

  it('fails naming every unexcused finding', () => {
    audited(JSON.stringify(report({ esbuild: { severity: 'low', via: [advisory('GHSA-dddd-eeee-ffff', 'low')] } })));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('audit: esbuild (low): https://github.com/advisories/GHSA-dddd-eeee-ffff');
  });

  it('fails naming npm when its answer is not an audit', () => {
    audited('npm error code ENOTFOUND', 1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(main([])).toBe(1);
    expect(error).toHaveBeenCalledWith('audit: npm audit gave no report (exit 1): npm error code ENOTFOUND');
  });
});

describe('the exceptions file', () => {
  it('holds only the picomatch advisory Shyden excused, each exception naming its advisory, package, reason and ruling', () => {
    const exceptions = JSON.parse(readFileSync('audit-exceptions.json', 'utf8')) as AuditException[];
    expect(exceptions.map(({ advisory: id, package: name }) => `${id} ${name}`)).toEqual([`${PICOMATCH} picomatch`]);
    for (const exception of exceptions) {
      expect(exception.advisory).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
      expect(exception.reason).not.toBe('');
      expect(exception.ruled).toMatch(/^Shyden \d{4}-\d{2}-\d{2}, shyden-labs\/ShyTalk#\d+$/);
    }
  });
});

describe('the session-start check', () => {
  it('runs fix-check at every session start in this project (Shyden 2026-11-18, shyden-labs/ShyTalk#260)', () => {
    const settings = JSON.parse(readFileSync('.claude/settings.json', 'utf8')) as {
      hooks: { SessionStart: { hooks: { type: string; command: string }[] }[] };
    };
    expect(settings.hooks.SessionStart.flatMap(({ hooks }) => hooks)).toContainEqual({
      type: 'command',
      command: 'node "$CLAUDE_PROJECT_DIR"/scripts/audit.ts fix-check',
    });
  });
});

describe('fixCheck', () => {
  const answer = (patched: string | null, name = 'picomatch') =>
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ vulnerabilities: [{ package: { name }, first_patched_version: patched }] }), { status: 200 }),
      ),
    );

  it('reads each excused advisory from GitHub and says there is still no fix', async () => {
    const fetch = answer(null);
    expect(await fixCheck([EXCUSE], fetch)).toEqual([`audit: ${PICOMATCH} (picomatch) still names no fixed release`]);
    expect(fetch).toHaveBeenCalledWith(`https://api.github.com/advisories/${PICOMATCH}`, {
      headers: { accept: 'application/vnd.github+json' },
    });
  });

  it('says to take a fixed release now and delete the exception', async () => {
    expect(await fixCheck([EXCUSE], answer('4.0.8'))).toEqual([
      `audit: FIX AVAILABLE: picomatch 4.0.8 fixes ${PICOMATCH}. Take it now and delete the exception from audit-exceptions.json (Shyden 2026-11-18, shyden-labs/ShyTalk#260)`,
    ]);
  });

  it('reads the fix for the excused package only', async () => {
    expect(await fixCheck([EXCUSE], answer('9.9.9', 'other'))).toEqual([`audit: ${PICOMATCH} (picomatch) still names no fixed release`]);
  });

  it('says the check could not run when GitHub does not answer, never staying silent', async () => {
    const down = vi.fn(() => Promise.resolve(new Response('', { status: 503 })));
    expect(await fixCheck([EXCUSE], down)).toEqual([`audit: could not check ${PICOMATCH} for a fix: GitHub answered 503`]);
    const offline = vi.fn(() => Promise.reject(new Error('fetch failed')));
    expect(await fixCheck([EXCUSE], offline)).toEqual([`audit: could not check ${PICOMATCH} for a fix: fetch failed`]);
  });

  it('runs from main with fix-check, printing each line and passing', async () => {
    vi.stubGlobal('fetch', answer(null));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await main(['fix-check'])).toBe(0);
    expect(log).toHaveBeenCalledWith(`audit: ${PICOMATCH} (picomatch) still names no fixed release`);
    vi.unstubAllGlobals();
  });
});
