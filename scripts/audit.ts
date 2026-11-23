/**
 * CI's dependency audit (shyden-labs/ShyTalk#260):
 *
 *   node scripts/audit.ts              fails on every finding not wholly from an excused advisory
 *   node scripts/audit.ts fix-check    says whether an excused advisory now names a fixed release
 *
 * An advisory is excused only by name, in `audit-exceptions.json`, on Shyden's ruling. An excuse whose advisory the
 * audit no longer reports fails the audit, so it is deleted at once. `fix-check` runs at every session start (the
 * project's SessionStart hook): Shyden 2026-11-18, "every session start needs to check for an update and apply it
 * immediately if so, then remove the exception".
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';

export interface AuditException {
  advisory: string;
  package: string;
  reason: string;
  ruled: string;
}

/** An advisory as `npm audit --json` names it inside a finding. */
interface Advisory {
  url: string;
  severity: string;
}

/** The part of `npm audit --json` read here: each vulnerable package, and what makes it so. */
export interface AuditReport {
  vulnerabilities: Record<string, { severity: string; via: (string | Advisory)[] }>;
}

const advisoryId = (advisory: Advisory): string => advisory.url.slice(advisory.url.lastIndexOf('/') + 1);

/**
 * Every finding not wholly from an excused advisory, as `name (severity): why`, then every excuse the audit no longer
 * needs. A package is excused when each of its own advisories is excused and each package it is vulnerable through is.
 */
export function unexcused(report: AuditReport, exceptions: AuditException[]): string[] {
  const excused = new Set(exceptions.map(({ advisory }) => advisory));
  const findings = report.vulnerabilities;
  const settled = new Map<string, boolean>();
  const isExcused = (name: string): boolean => {
    const known = settled.get(name);
    if (known !== undefined) return known;
    const finding = findings[name];
    if (finding === undefined) return false;
    // A loop through this package does not decide it: its other causes do.
    settled.set(name, true);
    const answer = finding.via.every((cause) => (typeof cause === 'string' ? isExcused(cause) : excused.has(advisoryId(cause))));
    settled.set(name, answer);
    return answer;
  };
  const lines: string[] = [];
  for (const [name, { severity, via }] of Object.entries(findings)) {
    if (severity === 'info' || isExcused(name)) continue;
    const own = via.filter((cause): cause is Advisory => typeof cause !== 'string' && !excused.has(advisoryId(cause)));
    const why =
      own.length > 0
        ? own.map(({ url }) => url).join(', ')
        : `through ${via.filter((cause): cause is string => typeof cause === 'string').join(', ')}`;
    lines.push(`${name} (${severity}): ${why}`);
  }
  const reported = new Set(
    Object.values(findings).flatMap(({ via }) => via.filter((cause): cause is Advisory => typeof cause !== 'string').map(advisoryId)),
  );
  for (const { advisory } of exceptions) {
    if (!reported.has(advisory)) lines.push(`${advisory} is excused but no longer reported: delete it from audit-exceptions.json`);
  }
  return lines;
}

/** One line per excused advisory: a fixed release to take now, still none, or why it could not be checked. */
export function fixCheck(exceptions: AuditException[], fetcher: typeof fetch): Promise<string[]> {
  if (exceptions.length === 0) return Promise.resolve(['audit: no exception to check for a fix']);
  return Promise.all(
    exceptions.map(async ({ advisory, package: name, ruled }) => {
      try {
        const answer = await fetcher(`https://api.github.com/advisories/${advisory}`, {
          headers: { accept: 'application/vnd.github+json' },
        });
        if (!answer.ok) throw new Error(`GitHub answered ${String(answer.status)}`);
        const { vulnerabilities } = (await answer.json()) as {
          vulnerabilities: { package: { name: string }; first_patched_version: string | null }[];
        };
        const fixed = vulnerabilities.find((entry) => entry.package.name === name)?.first_patched_version ?? null;
        return fixed === null
          ? `audit: ${advisory} (${name}) still names no fixed release`
          : `audit: FIX AVAILABLE: ${name} ${fixed} fixes ${advisory}. Take it now and delete the exception from audit-exceptions.json (${ruled})`;
      } catch (error) {
        return `audit: could not check ${advisory} for a fix: ${(error as Error).message}`;
      }
    }),
  );
}

/** The passing audit's line: each excused advisory with its package and ruling, or that it excused nothing. */
export function excusedLine(all: AuditException[]): string {
  const named = all.map(({ advisory, package: name, ruled }) => `${advisory} (${name}): ${ruled}`).join('; ');
  return `audit: no unexcused finding; excused ${named || 'nothing'}`;
}

const exceptions = (): AuditException[] => JSON.parse(readFileSync('audit-exceptions.json', 'utf8')) as AuditException[];

export function main(args: string[]): number | Promise<number> {
  if (args[0] === 'fix-check') {
    return fixCheck(exceptions(), fetch).then((lines) => {
      for (const line of lines) console.log(line);
      return 0;
    });
  }
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); // NOSONAR: found on PATH by design; gh reaches the App router on the Mac, and the folders differ on the Mac and in CI (#243)
  let report: AuditReport;
  try {
    report = JSON.parse(run.stdout) as AuditReport;
  } catch {
    console.error(`audit: npm audit gave no report (exit ${String(run.status)}): ${run.stdout}`);
    return 1;
  }
  const all = exceptions();
  const lines = unexcused(report, all);
  for (const line of lines) console.error(`audit: ${line}`);
  if (lines.length > 0) return 1;
  console.log(excusedLine(all));
  return 0;
}

await runIfEntry(import.meta.url, main);
