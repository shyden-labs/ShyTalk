/**
 * A check is green only if it ran and passed (Shyden 2026-10-18: "don't pass
 * if it doesn't run"; issue shyden-labs/repo-template#27). These read a workflow's comment-stripped
 * text and name each way it could pass without doing its job.
 */
import { withoutYamlComments } from './source-text.ts';

/** What swallows a failure: `|| true`, `|| exit 0`, `|| :`, or `continue-on-error: true`. */
const SWALLOW = /\|\|\s*(?:true|exit\s+0|:)(?:\s|$)|\bcontinue-on-error:\s*true\b/;

const lines = (text: string) => withoutYamlComments(text).split('\n');

/** Each line that lets a failing command pass. */
export function swallowed(file: string, text: string): string[] {
  return lines(text).flatMap((l, i) => (SWALLOW.test(l) ? [`${file}:${i + 1} swallows a failure: ${l.trim()}`] : []));
}

/** Each step condition on the SonarCloud token: a step that runs, or does not, by whether the key is set. */
export function tokenGated(file: string, text: string): string[] {
  return lines(text).flatMap((l, i) => (/\bif:.*SONAR_TOKEN/.test(l) ? [`${file}:${i + 1} gates a step on the token: ${l.trim()}`] : []));
}

/** A scan with no step after it that reads the verdict. */
export function scanWithoutVerdict(file: string, text: string): string[] {
  const all = lines(text);
  const scan = all.findIndex((l) => l.includes('SonarSource/sonarqube-scan-action@'));
  if (scan === -1) return [];
  return all.slice(scan + 1).some((l) => l.includes('scripts/sonar-verdict.ts'))
    ? []
    : [`${file} scans, but no step after it runs scripts/sonar-verdict.ts`];
}
