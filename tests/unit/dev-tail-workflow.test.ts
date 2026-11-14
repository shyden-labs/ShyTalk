import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutYamlComments, withoutYamlQuotes, yamlBlock as topLevel } from './source-text.ts';

/**
 * Watching dev's live log stream (shyden-labs/ShyTalk#204; Shyden 2026-11-14:
 * a hand-started job, nothing stored, production untouched). The repository
 * is public, so its job log is too: only each failing request's time, outcome,
 * method, path and exceptions are printed, never a header, query or body.
 * Read from comment-stripped, quote-free text.
 */

const source = () => withoutYamlComments(readFileSync('.github/workflows/dev-tail.yml', 'utf8'));
const job = () => withoutYamlQuotes(source());

describe('dev-tail', () => {
  it('runs only when started by hand, for a number of minutes', () => {
    expect(topLevel(job(), 'on').split('\n')).toEqual([
      'on:',
      '  workflow_dispatch:',
      '    inputs:',
      '      minutes:',
      '        description: How long to watch, 1 to 30',
      '        required: true',
      '        default: 10',
      '        type: number',
    ]);
  });

  it('reads only, in the dev environment, with dev’s own key', () => {
    const text = job();
    expect(topLevel(text, 'permissions').split('\n')).toEqual(['permissions:', '  contents: read']);
    expect(text.split('\n').filter((line) => /^ {4}environment:/.test(line))).toEqual(['    environment: dev']);
    expect(text).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(text).not.toMatch(/prod|production|release/i);
  });

  it('watches dev for the asked minutes, at most 30, and a timeout ending the watch is not a failure', () => {
    const text = source();
    expect(text).toContain('if [ "$MINUTES" -lt 1 ] || [ "$MINUTES" -gt 30 ]; then');
    expect(text).toContain('timeout "$((MINUTES * 60))" npx wrangler tail --env dev --format json');
    expect(text).toContain('[ "$status" -eq 124 ]');
  });

  it('prints only the time, outcome, method, path and exceptions of a request that did not end ok', () => {
    const text = source();
    expect(text).toContain(
      'jq -c --unbuffered \'select(.outcome != "ok" or (.exceptions | length) > 0) | {at: .eventTimestamp, outcome, method: .event.request.method, path: (.event.request.url | sub("^https?://[^/]+"; "") | sub("[?#].*$"; "")), ',
    );
    expect(text).not.toMatch(/headers|\.logs/);
  });

  it('blanks every email address and long token-like string in an exception before printing it', () => {
    expect(source()).toContain(
      'exceptions: [.exceptions[] | {name, message: (.message | gsub("[^\\\\s@]+@[^\\\\s@]+"; "<email>") | gsub("[A-Za-z0-9_+/=-]{20,}"; "<token>"))}]',
    );
  });

  it('prints how many events it saw in all, so an empty watch is told apart from a broken stream', () => {
    const text = source();
    expect(text).toContain('| tee "$RUNNER_TEMP/events" \\');
    expect(text).toContain('seen=$(wc -l < "$RUNNER_TEMP/events")');
    expect(text).toContain('if [ "$seen" -eq 0 ]; then');
    expect(text).toContain('echo "Watched dev for $MINUTES minutes: $seen events."');
  });
});
