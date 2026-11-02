import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { yamlLinesWithoutComments } from './source-text.ts';

/**
 * No workflow approves a dependency's install script past package.json's
 * `allowScripts` (issue shyden-labs/repo-template#78): that field, and `.npmrc` pinned whole beside it
 * (shyden-labs/repo-template#70), are the only places the decision is made. Read from comment-stripped
 * text, so a comment naming a flag neither trips the guard nor hides one.
 *
 * What npm 11.20.0 reads as an approval, measured 2026-10-23 with
 * `npm config get` in a scratch project (`@npmcli/config` `loadEnv`, its
 * definitions, and nopt's abbreviations; the table is on shyden-labs/repo-template#78):
 * - an option, from the shortest prefix npm expands to it. `--allow-scripts`
 *   has none shorter, since `allow-scripts-pending` and `-pin` share it. A new
 *   npm can only lengthen these; re-measure if it removes a setting.
 * - an environment name, `npm_config_` in any case with `_` or `-` after it,
 *   never abbreviated (`npm_config_dangerously` sets nothing).
 * - the setting's own name, as `npm config set` or an npmrc line writes it.
 * - a command that rewrites `allowScripts`, from the shortest prefix npm runs.
 */

/** Each setting that approves a script, with the shortest option npm expands to it. */
const SETTINGS: readonly (readonly [string, number])[] = [
  ['allow-scripts', 13],
  ['dangerously-allow-all-scripts', 5],
  // false lets every later approval take any version of the package, not the one approved.
  ['allow-scripts-pin', 16],
  // Another rc file can hold an allow-scripts line that the pinned .npmrc never sees.
  ['userconfig', 5],
  ['globalconfig', 7],
];

/** Each npm command that rewrites allowScripts, with the shortest prefix npm runs it from. */
const COMMANDS: readonly (readonly [string, number])[] = [
  ['approve-scripts', 2],
  ['install-scripts', 9],
];

const abbreviates = (word: string, [name, shortest]: readonly [string, number]) => word.length >= shortest && name.startsWith(word);

/** The words of a shell line as npm will see them: quotes and escapes gone, case ignored, `_` read as `-`. */
const words = (line: string): string[] =>
  line
    .replace(/["'\\]/g, '')
    .toLowerCase()
    .replace(/_/g, '-')
    .match(/[\w$-]+/g) ?? [];

/** Whether a word names an approval, or is built from a `$` the guard cannot read. */
function approves(word: string, afterNpm: boolean): boolean {
  // npm reads --no-<setting> as the setting set false, and abbreviates it the same way.
  const option = /^--(?:no-)?(.*)$/.exec(word)?.[1];
  if (option !== undefined) return option.startsWith('$') || SETTINGS.some((s) => abbreviates(option, s));
  // Any start of a setting's environment name, which a later word or variable may complete.
  const env = /^-*npm-config-(.*)$/.exec(word)?.[1];
  if (env !== undefined) return env.includes('$') || SETTINGS.some(([name]) => name.startsWith(env));
  // A setting's own name, or package.json's field, however the line reaches it (`npm pkg set allowScripts.x`).
  const name = word.replace(/^-+/, '');
  if (name === 'allowscripts' || SETTINGS.some(([setting]) => setting === name)) return true;
  return afterNpm && (word.startsWith('$') || COMMANDS.some((c) => abbreviates(word, c)));
}

/**
 * What a line does that the words cannot show: ANSI-C quoting (`$'\x2d'`) the guard
 * does not decode, a write to a file that holds the policy, or a local action
 * outside the folder this guard reads.
 */
const UNREAD = [/\$'/, /\bnpmrc\b/i, /\bpackage\.json\b/i, /\buses:\s*["']?\.\/(?!\.github\/)/, /\buses:.*\.\./];

/**
 * Every line of a file that approves an install script, as `<file>:<line> <text>`,
 * and how many of the file's lines were read. A line ending in `\` is read with the
 * next, as the shell joins them.
 */
export function approvals(file: string, text: string): { read: number; findings: string[] } {
  const lines = yamlLinesWithoutComments(text).map((line) => line.replace(/\r$/, ''));
  const findings: string[] = [];
  // The lines judged, counted as the loop takes them, so a reader that stops early reads short.
  let read = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const start = i;
    let line = lines[i] as string;
    while (line.endsWith('\\') && i + 1 < lines.length) line = line.slice(0, -1) + (lines[++i] as string).trimStart();
    read += i - start + 1;
    const all = words(line);
    const npm = all.indexOf('npm');
    if (UNREAD.some((u) => u.test(line)) || all.some((w, n) => approves(w, npm !== -1 && n > npm))) {
      findings.push(`${file}:${start + 1} ${line.trim()}`);
    }
  }
  return { read, findings };
}

// Every YAML file under .github: workflows, and any local action or reusable workflow they use.
const GITHUB = '.github';
const files = readdirSync(GITHUB, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();

describe('no workflow approves an install script past allowScripts', () => {
  it('judges every YAML file under .github', () => {
    expect(files).toEqual([
      'ISSUE_TEMPLATE/config.yml',
      'ISSUE_TEMPLATE/story.yml',
      'dependabot.yml',
      'workflows/check-release-cut.yml',
      'workflows/ci.yml',
      'workflows/deploy-dev.yml',
      'workflows/deploy-doors.yml',
      'workflows/door-count-trigger.yml',
      'workflows/door-count.yml',
      'workflows/sonarcloud.yml',
    ]);
  });

  it.each(files)('%s approves no install script, read to its last line', (file) => {
    const text = readFileSync(`${GITHUB}/${file}`, 'utf8');
    expect(approvals(file, text)).toEqual({ read: text.split('\n').length, findings: [] });
  });
});

describe('the guard', () => {
  const findings = (...lines: string[]) => approvals('w.yml', `${lines.join('\n')}\n`).findings;

  it.each([
    ['the variable in the workflow env', 'env:', '  npm_config_allow_scripts: fsevents'],
    ['the variable in a job env', '    env:', '      npm_config_allow_scripts: fsevents'],
    ['the variable in capitals in a job env', '    env:', '      NPM_CONFIG_ALLOW_SCRIPTS: fsevents'],
    ['the variable in mixed case in a job env', '    env:', '      Npm_Config_Allow_Scripts: fsevents'],
    ['the variable with a dash in a job env', '    env:', '      npm_config_allow-scripts: fsevents'],
    ['the bypass variable in a job env', '    env:', '      npm_config_dangerously_allow_all_scripts: true'],
    ['the variable in a step env', '        env:', '          npm_config_allow_scripts: fsevents'],
    ['the variable in capitals', '        env:', '          NPM_CONFIG_ALLOW_SCRIPTS: fsevents'],
    ['the variable in mixed case', '        env:', '          Npm_Config_Allow_Scripts: fsevents'],
    ['the variable with a dash', '        env:', '          npm_config_allow-scripts: fsevents'],
    ['the variable quoted', '        env:', "          'npm_config_allow_scripts': fsevents"],
    ['the bypass variable', '        env:', '          NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_SCRIPTS: true'],
    ['the rc file variable', '        env:', '          npm_config_userconfig: other'],
    ['the global rc file variable', '        env:', '          NPM_CONFIG_GLOBALCONFIG: other'],
    ['the unpinned approvals variable', '        env:', '          NPM_CONFIG_ALLOW_SCRIPTS_PIN: false'],
  ])('names %s', (_kind, env, variable) => {
    expect(findings('jobs:', env, variable)).toEqual([`w.yml:3 ${variable.trim()}`]);
  });

  it.each([
    ['the flag on an npm ci line', '      - run: npm ci --allow-scripts=fsevents'],
    ['the flag with its value apart', '      - run: npm ci --allow-scripts fsevents'],
    ['the bypass flag', '      - run: npm ci --dangerously-allow-all-scripts'],
    ['the bypass flag abbreviated as npm reads it', '      - run: npm ci --dangerously'],
    ['the shortest abbreviation npm expands', '      - run: npm ci --dange'],
    ['another user rc file', '      - run: npm ci --userconfig other'],
    ['another user rc file, abbreviated', '      - run: npm ci --userc=other'],
    ['another global rc file', '      - run: npm ci --globalconfig=other'],
    ['another global rc file, abbreviated', '      - run: npm ci --globalc other'],
    ['the variable before a command', '      - run: npm_config_allow_scripts=fsevents npm ci'],
    ['the variable exported', '      - run: export NPM_CONFIG_ALLOW_SCRIPTS=fsevents'],
    ['the variable for later steps', '      - run: echo "npm_config_allow_scripts=fsevents" >> "$GITHUB_ENV"'],
    ['the setting set by npm', '      - run: npm config set allow-scripts fsevents'],
    ['the setting written to an rc file', '      - run: echo allow-scripts=fsevents >> .npmrc'],
    ['an approval command', '      - run: npm approve-scripts fsevents'],
    ['an approval command abbreviated as npm runs it', '      - run: npm ap fsevents'],
    ['an approval command after an option', '      - run: npm --silent approve-scripts --all'],
    ['the install-scripts command, whatever its subcommand', '      - run: npm install-scripts ls'],
    ['the install-scripts command abbreviated', '      - run: npm install-s ls'],
    ['an approval through npx', '      - run: npx --allow-scripts=fsevents some-tool'],
    ['a flag split by quotes', '      - run: npm ci --"dang"erously'],
    ['a flag split by an escape', '      - run: npm ci --dang\\erously'],
    ['a flag the guard cannot read', '      - run: npm ci --$FLAG'],
    ['a command the guard cannot read', '      - run: npm $COMMAND'],
    ['an environment name the guard cannot read', '      - run: export npm_config_${KEY}=fsevents'],
    ['an environment name with nothing after its prefix', '      - run: export NPM_CONFIG_=fsevents'],
    ['part of an environment name a variable completes', '      - run: export npm_config_allow${REST}=fsevents'],
    ['part of an environment name npm would not read alone', '      - run: export npm_config_dangerously=true'],
    ['an environment name built after its prefix', '      - run: export ${PREFIX}_ALLOW_SCRIPTS=fsevents'],
    ['an environment name in ANSI-C quotes', "      - run: export $'npm_config_allow_scripts'=fsevents"],
    ['ANSI-C escapes the guard does not decode', "      - run: npm ci $'\\x2d\\x2dallow-scripts'=fsevents"],
    ['unpinned approvals', '      - run: npm ci --allow-scripts-pin=false'],
    ['unpinned approvals, abbreviated', '      - run: npm ci --allow-scripts-pi=false'],
    ['unpinned approvals, negated', '      - run: npm ci --no-allow-scripts-pin'],
    ['unpinned approvals, negated and abbreviated', '      - run: npm ci --no-allow-scripts-pi'],
    ['the package.json field set by npm', '      - run: npm pkg set allowScripts.esbuild=true'],
    ['the package.json field set by another tool', "      - run: jq '.allowScripts.esbuild = true' manifest > out"],
    ['a write to package.json', '      - run: cp ci/package.json package.json'],
    ['a write to an rc file', '      - run: cp ci.npmrc ~/.npmrc'],
    ['a local action outside .github', '      - uses: ./actions/build'],
    ['a quoted local action outside .github', "      - uses: './actions/build'"],
    ['a local action that climbs out of .github', '      - uses: ./.github/../actions/build'],
  ])('names %s', (_kind, line) => {
    expect(findings('jobs:', line)).toEqual([`w.yml:2 ${line.trim()}`]);
  });

  it('reads a line continued with a backslash as the shell joins it, naming its first line and counting both', () => {
    expect(approvals('w.yml', 'jobs:\n      - run: |\n          npm ci --da\\\n            ngerously\n')).toEqual({
      read: 5,
      findings: ['w.yml:3 npm ci --dangerously'],
    });
  });

  it('joins a continued line that ends in a carriage return', () => {
    expect(approvals('w.yml', 'jobs:\r\n  - run: npm ci --da\\\r\n    ngerously\r\n').findings).toEqual([
      'w.yml:2 - run: npm ci --dangerously',
    ]);
  });

  it('names the file’s own line, past blank and comment-only lines', () => {
    expect(findings('jobs:', '', '  # a note', '      - run: npm ci --dange')).toEqual(['w.yml:4 - run: npm ci --dange']);
  });

  it.each([
    ['a comment naming the flag', '      - run: npm ci # never --allow-scripts here'],
    ['a bare install', '      - run: npm ci'],
    ['a script', '      - run: npm run test:unit'],
    ['an option that only starts like allow-scripts', '      - run: git fetch --all'],
    ['an option that only starts like globalconfig', '      - run: prettier --glob=x'],
    ['an option that only starts like userconfig', '      - run: tool --user=y'],
    ['a strict policy', '      - run: npm ci --strict-allow-scripts'],
    ['scripts ignored', '      - run: npm ci --ignore-scripts'],
    // One letter short of each shortest form npm expands (measured on shyden-labs/repo-template#78).
    ['allow-scripts one letter short', '      - run: npm ci --allow-script=fsevents'],
    ['the bypass one letter short', '      - run: npm ci --dang'],
    ['userconfig one letter short', '      - run: npm ci --user=other'],
    ['globalconfig one letter short', '      - run: npm install --global some-tool'],
    ['allow-scripts-pin one letter short', '      - run: npm ci --allow-scripts-p=false'],
    ['approve-scripts one letter short', '      - run: npm a fsevents'],
    ['install-scripts one letter short', '      - run: npm install- fsevents'],
    ['a setting that only lists', '      - run: npm ci --allow-scripts-pending'],
    ['another npm setting from the environment', '        env:\n          npm_config_loglevel: silent'],
    ['a listing setting that approves nothing', '      - run: npm ls --allow-scripts-pending'],
    ['a local action inside .github', '      - uses: ./.github/actions/build'],
    ['a pinned action', '      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567'],
    ['a command word that is not after npm', '      - run: git apply ap.patch && echo approve-scripts'],
    ['a dollar after a command that is not npm', '      - run: echo $HOME --x'],
  ])('reads %s as nothing', (_kind, line) => {
    expect(findings('jobs:', line)).toEqual([]);
  });

  it('reads every line of the file, the last one included', () => {
    expect(approvals('w.yml', 'a: 1\n\n# c\nb: 2').read).toBe(4);
  });
});
