/**
 * Comment stripping for the guards that assert against source text. shyden-labs/repo-template#24.
 *
 * Several suites in this repo read a file as TEXT and assert that something
 * appears in it, or does not. Every one of them is exposed to the same defect,
 * and this repo has now shipped it three times:
 *
 * 1. shyden-labs/repo-template#23 — `supply-chain.test.ts` asserted `dependabot.yml` contained
 *    `"actions/cache*"`, and the file's own explanatory NOTE spelled that
 *    pattern out verbatim. No group was configured at all; the suite was
 *    green.
 * 2. shyden-labs/repo-template#21 Stage 4 — `pipeline-wiring.test.ts`'s first dev-sanity check searched
 *    raw text, and pointing the run step at a different config left it green,
 *    because that file's own comment explaining the fix contained the filename
 *    it was looking for.
 * 3. shyden-labs/repo-template#35 — the pre-push hook guard asserted the hook source contained
 *    `npm run test:unit`. It passed while the hook did NOT run it: the string
 *    survived inside the failure hint the hook prints telling you how to run
 *    it by hand.
 *
 * All three read as obviously correct. None was found by review; each was
 * found by mutation, which is why the standing rule pairs the two: assert on
 * the stripped text, and watch it fail.
 *
 * THE INVERSE IS ALSO A DEFECT and is easier to miss, because nothing goes
 * red. `dead-copy.test.ts` asserts ABSENCE — a key is dead if nothing
 * references it — so a comment naming a key keeps a dead key looking alive and
 * SUPPRESSES a finding rather than satisfying an assertion. Same cause, no
 * symptom.
 */

/**
 * YAML with comments removed, inline ones included, and blank lines dropped.
 *
 * `# vX.Y.Z` beside a pinned action SHA is meaningful data, not prose, so
 * anything checking those version comments must read the RAW text — this is
 * for config bodies where a `#` is always commentary.
 *
 * A block scalar (`key: |` or `key: >`, with any chomping or indentation
 * indicator) and a quoted value are text, not comments (shyden-labs/repo-template#54): a workflow's
 * `run: |` shell, or a form's note that writes `Refs #N`, is kept whole. A
 * block scalar runs until a line indented no deeper than its key (for a list
 * item, the key's column after the dash). A quote opens only at the start of a
 * value, so an apostrophe in plain text (`don't`) hides no comment.
 */
export function withoutYamlComments(text: string): string {
  return yamlLinesWithoutComments(text)
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/**
 * The same text, one entry per line of the file: a blank or comment-only line
 * is kept as '', so an index plus one is the file's own line number (shyden-labs/repo-template#78).
 */
export function yamlLinesWithoutComments(text: string): string[] {
  const out: string[] = [];
  // The column of the key whose block scalar is being read, or null.
  let blockKey: number | null = null;
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    if (blockKey !== null && line.length - line.trimStart().length > blockKey) {
      out.push(line);
      continue;
    }
    blockKey = null;
    const kept = yamlLineWithoutComment(line);
    out.push(kept.trim() === '' ? '' : kept);
    if (/:\s+[|>][-+0-9]*$/.test(kept)) blockKey = (/^\s*(?:-\s+)*/.exec(kept) as RegExpExecArray)[0].length;
  }
  return out;
}

/** One YAML line with its comment cut off: a `#` at the line's start or after whitespace, outside quotes. */
function yamlLineWithoutComment(line: string): string {
  let quote: string | null = null;
  let valueStart = true;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (quote !== null) {
      // A doubled '' in a single-quoted value closes and at once reopens the quote: still a value start.
      if (quote === '"' && char === '\\') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '#' && (i === 0 || /\s/.test(line[i - 1] as string))) return line.slice(0, i).trimEnd();
    if ((char === '"' || char === "'") && valueStart) {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) continue;
    valueStart = ':-,[{'.includes(char);
  }
  return line;
}

/**
 * YAML with its scalar quote characters removed.
 *
 * Quoting in YAML is a STYLE, not a meaning: `'actions/cache*'` and
 * `"actions/cache*"` are the same scalar. A guard that greps for one spelling
 * reports a correct config as missing, which is a false ALARM rather than a
 * false pass -- the safe direction, but it reddens CI on config that is right
 * and sends whoever hits it hunting a problem that does not exist.
 *
 * Found by building the org template repository against this repo's own
 * supply-chain guard. The template configured the sub-path group in this
 * repo's own house style (single quotes, as `'npm'` and `'develop'` are
 * written) and the guard called it ungrouped.
 *
 * Only the quote characters go; separators and structure stay, so `['a','b']`
 * becomes `[a,b]` and two scalars cannot merge into one.
 */
export const withoutYamlQuotes = (text: string): string => text.replace(/['"]/g, '');

/**
 * Text with every full commit SHA after `@` read as `@<sha>` (issue shyden-labs/repo-template#51), so
 * a test of a workflow's shape is not broken by a sound Dependabot bump. Only
 * exactly 40 lower-case hex digits count: a tag or a short SHA stays as it is
 * and never passes as a pin. Whether each action IS pinned, and at one SHA in
 * every workflow, is `supply-chain.test.ts`'s job.
 */
export const withoutPinnedShas = (text: string): string => text.replace(/@[0-9a-f]{40}(?![0-9a-zA-Z])/g, '@<sha>');

/**
 * The block a YAML key opens, its own line included, from comment-stripped
 * text: the line `<indent><key>:` up to the next line indented no deeper
 * than it. '' when the key is absent, so a test of a missing block fails.
 */
export function yamlBlock(text: string, key: string, indent = ''): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`${indent}${key}:`);
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && line.length - line.trimStart().length <= indent.length);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/**
 * Text with whole-line comments removed, for a given marker.
 *
 * Deliberately leaves trailing comments alone: a GitHub workflow's `run:`
 * blocks are shell, where `#` inside a quoted string is not a comment, and
 * removing those would change the very commands being asserted about.
 */
export const withoutCommentLines = (text: string, marker = '#'): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(marker))
    .join('\n');

/**
 * TypeScript with `//` and block comments removed, STRING LITERALS INTACT.
 *
 * A regex cannot do this correctly and the failures are the ones that matter:
 * `https://…` is not a comment, and `expect(x).toContain('// ')` is a string
 * whose content is the point. Since these guards exist to stop text in the
 * wrong place satisfying an assertion, a stripper that mangles the right place
 * is the same bug wearing the opposite coat — so this scans rather than
 * matches. Quotes and escapes are tracked, and so are regex literals and
 * `${…}` inside template literals (shyden-labs/repo-template#40): a regex such as `/x\/\//` or a
 * backtick in a string inside `${…}` otherwise reads as a comment or ends the
 * template, and every comment after it survives.
 *
 * A `/` starts a regex literal when the text before it ends in an operator,
 * an opening bracket, a keyword such as `return`, or nothing at all; after a
 * name, a number, `)` or `]` it is division. A regex runs to its closing `/`
 * outside a character class, or to the end of its line if it never closes.
 */
export function withoutTsComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  // One entry per open template literal: 'text' while reading its text, or the
  // brace depth of the `${…}` being read as code.
  const templates: (number | 'text')[] = [];

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] as string;
    const next = source[i + 1];
    const top = templates.at(-1);

    if (quote) {
      out += char;
      if (char === '\\') {
        out += source[i + 1] ?? '';
        i += 1;
      } else if (char === quote) quote = null;
      continue;
    }

    if (top === 'text') {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '`') templates.pop();
      else if (char === '$' && next === '{') {
        out += next;
        i += 1;
        templates.push(0);
      }
      continue;
    }

    if (char === '`') {
      templates.push('text');
      out += char;
      continue;
    }

    if (typeof top === 'number') {
      if (char === '{') templates[templates.length - 1] = top + 1;
      if (char === '}') {
        if (top === 0) templates.pop();
        else templates[templates.length - 1] = top - 1;
      }
    }

    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    if (char === '/' && regexMayStart(out)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += 1;
      }
      const end = source[j] === '/' ? j + 1 : j;
      out += source.slice(i, end);
      i = end - 1;
      continue;
    }

    out += char;
  }

  return out;
}

/** What may stand right before a regex literal; before anything else, `/` is division. */
const BEFORE_REGEX = /(?:[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await))$/;

/** Whether a `/` after `out` starts a regex literal. Reads only the tail, so a long file costs no more per slash. */
function regexMayStart(out: string): boolean {
  const before = out.trimEnd();
  return before === '' || BEFORE_REGEX.test(before.slice(-12));
}
