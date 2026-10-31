import { describe, it, expect } from 'vitest';
import {
  withoutCommentLines,
  withoutPinnedShas,
  withoutTsComments,
  withoutYamlComments,
  yamlBlock,
  yamlLinesWithoutComments,
} from './source-text.ts';

describe('withoutYamlComments', () => {
  const y = (...lines: string[]) => lines.join('\n');

  it.each([
    ['a whole-line comment, and the blank lines', y('a: 1', '# gone', '', '  # gone', 'b: 2'), y('a: 1', 'b: 2')],
    ['a trailing comment after a space', y('a: 1 # gone', 'b: 2\t# gone'), y('a: 1', 'b: 2')],
    [
      'nothing in a value where # follows no space',
      y('url: https://x.example/#top', 'tag: v1#2'),
      y('url: https://x.example/#top', 'tag: v1#2'),
    ],
  ])('drops %s', (_kind, text, stripped) => {
    expect(withoutYamlComments(text)).toBe(stripped);
  });

  // Block scalars and quoted values hold text, not comments (shyden-labs/repo-template#54).
  it.each([
    [
      'a literal block scalar',
      y('run: |', '  echo "step #2"', '  x # stays', 'next: 1 # gone'),
      y('run: |', '  echo "step #2"', '  x # stays', 'next: 1'),
    ],
    ['a folded block scalar', y('note: >', '  Write `Refs #N`.', 'next: 1'), y('note: >', '  Write `Refs #N`.', 'next: 1')],
    [
      'a block scalar with chomping and indent indicators',
      y('a: |-', '  # kept', 'b: >+2', '    # kept', 'c: |2-', '    # kept'),
      y('a: |-', '  # kept', 'b: >+2', '    # kept', 'c: |2-', '    # kept'),
    ],
    ['a block scalar whose indicator carries a comment', y('run: | # gone', '  echo #1'), y('run: |', '  echo #1')],
    [
      'a block scalar in a list item, ending at its next key',
      y('  - run: |', '      echo #1', '    env: x # gone'),
      y('  - run: |', '      echo #1', '    env: x'),
    ],
    ['a block scalar that ends the file', y('a: 1', 'run: |', '  echo #1'), y('a: 1', 'run: |', '  echo #1')],
    ['a double-quoted value', y('name: "a #b" # gone'), y('name: "a #b"')],
    ['an escaped quote in a double-quoted value', y('x: "a \\" #b" # gone'), y('x: "a \\" #b"')],
    ['a single-quoted value', y("name: 'a #b' # gone"), y("name: 'a #b'")],
    ['a doubled quote in a single-quoted value', y("x: 'it''s #b' # gone"), y("x: 'it''s #b'")],
    ['a quoted list item', y("- 'a #b' # gone"), y("- 'a #b'")],
    ['a quoted value in a flow list', y("on: [push, 'a #b'] # gone"), y("on: [push, 'a #b']")],
  ])('keeps the text of %s', (_kind, text, stripped) => {
    expect(withoutYamlComments(text)).toBe(stripped);
  });

  it('reads an apostrophe inside a plain value as text, so the comment after it still goes', () => {
    expect(withoutYamlComments("x: don't # gone")).toBe("x: don't");
  });

  it('reads an unclosed quote to the end of its line, so the next line is read afresh', () => {
    expect(withoutYamlComments(y('x: "a #b', 'y: 1 # gone'))).toBe(y('x: "a #b', 'y: 1'));
  });
});

// One entry per line of the file, so a guard can name the file's own line number (shyden-labs/repo-template#78).
describe('yamlLinesWithoutComments', () => {
  it('keeps a blank, a comment-only and a whitespace-only line as empty, in place', () => {
    expect(yamlLinesWithoutComments(['a: 1', '', '# gone', '  # gone', '   ', 'b: 2 # gone'].join('\n'))).toEqual([
      'a: 1',
      '',
      '',
      '',
      '',
      'b: 2',
    ]);
  });

  it('keeps a block scalar whole across a blank line inside it', () => {
    expect(yamlLinesWithoutComments(['run: |', '  a # stays', '', '  b # stays', 'c: 1 # gone'].join('\n'))).toEqual([
      'run: |',
      '  a # stays',
      '',
      '  b # stays',
      'c: 1',
    ]);
  });

  it('ends a block scalar at a key that follows a comment-only line', () => {
    expect(yamlLinesWithoutComments(['run: |', '  a', '# gone', 'c: 1 # gone'].join('\n'))).toEqual(['run: |', '  a', '', 'c: 1']);
  });
});

/**
 * The template's shared text strippers, for guards that read files as text.
 * A repository made from the template uses these rather than writing its own,
 * so each behaviour a guard relies on is pinned here.
 */

describe('withoutPinnedShas', () => {
  const SHA = '820762786026740c76f36085b0efc47a31fe5020';

  it('reads a full commit SHA after @ as <sha>, so a sound bump changes nothing a shape test sees', () => {
    expect(withoutPinnedShas(`      - uses: actions/setup-node@${SHA} # v7.0.0\n      - uses: a/b@${SHA}`)).toBe(
      '      - uses: actions/setup-node@<sha> # v7.0.0\n      - uses: a/b@<sha>',
    );
  });

  it.each([
    ['a tag', '@v7'],
    ['a short SHA', `@${SHA.slice(0, 39)}`],
    ['a longer hex run', `@${SHA}0`],
    ['upper-case hex', `@${SHA.toUpperCase()}`],
  ])('leaves %s as it is, so it never passes as a pin', (_kind, ref) => {
    expect(withoutPinnedShas(`uses: actions/checkout${ref}`)).toBe(`uses: actions/checkout${ref}`);
  });
});

describe('yamlBlock', () => {
  const YAML = [
    'on:',
    '  push:',
    '    branches: [develop]',
    'jobs:',
    '  build:',
    '    steps:',
    '      - run: x',
    '  test:',
    '    runs-on: y',
  ].join('\n');

  it('reads a top-level block up to the next top-level key', () => {
    expect(yamlBlock(YAML, 'on')).toBe('on:\n  push:\n    branches: [develop]');
  });

  it('reads a nested block up to its next sibling', () => {
    expect(yamlBlock(YAML, 'build', '  ')).toBe('  build:\n    steps:\n      - run: x');
  });

  it('reads a block that ends the file to its end', () => {
    expect(yamlBlock(YAML, 'test', '  ')).toBe('  test:\n    runs-on: y');
  });

  it('reads an absent key as empty, so a test of a missing block fails', () => {
    expect(yamlBlock(YAML, 'permissions')).toBe('');
  });
});

describe('withoutCommentLines', () => {
  it('drops whole-line # comments, indented or not, and keeps trailing ones', () => {
    expect(withoutCommentLines('a: 1 # kept\n  # gone\n# gone\nb: 2')).toBe('a: 1 # kept\nb: 2');
  });

  it('takes another marker', () => {
    expect(withoutCommentLines('x\n  // gone\nz', '//')).toBe('x\nz');
  });
});

describe('withoutTsComments', () => {
  it('removes a line comment, keeping the line break', () => {
    expect(withoutTsComments('a // note\nb')).toBe('a \nb');
  });

  it('removes a line comment that ends the file', () => {
    expect(withoutTsComments('a // note')).toBe('a \n');
  });

  it('removes a block comment', () => {
    expect(withoutTsComments('a /* note */b')).toBe('a b');
  });

  it('removes an unterminated block comment to the end of the file', () => {
    expect(withoutTsComments('a /* note')).toBe('a ');
  });

  it('keeps comment-like text inside \' " and ` strings', () => {
    const source = 'f(\'// a\', "/* b */", `// c`);';
    expect(withoutTsComments(source)).toBe(source);
  });

  it('keeps a string past an escaped quote', () => {
    const source = "f('it\\'s // here');";
    expect(withoutTsComments(source)).toBe(source);
  });

  it('keeps a string past an escaped backslash, then strips the comment after it', () => {
    expect(withoutTsComments("f('a\\\\'); // c")).toBe("f('a\\\\'); \n");
  });

  it('keeps an escape that ends the file inside a string', () => {
    expect(withoutTsComments("'abc\\")).toBe("'abc\\");
  });

  it('closes a string only on its own quote', () => {
    expect(withoutTsComments('f("it\'s"); // c')).toBe('f("it\'s"); \n');
  });

  it('keeps a lone slash that starts no comment', () => {
    expect(withoutTsComments('a / b')).toBe('a / b');
  });

  // Regex literals (shyden-labs/repo-template#40). Each case puts a comment AFTER the construct: a
  // stripper that misreads the construct shows it only where a comment sits.
  it.each([
    ['ends in an escaped slash before a slash (measured 2026-10-22)', 'const b = /x\\/\\//; f(); // c', 'const b = /x\\/\\//; f(); \n'],
    ['holds a slash and quotes in a character class', 'const c = /[/\'"]/g; // c', 'const c = /[/\'"]/g; \n'],
    ['holds quotes in a character class', 'const q = /[\'"`]/g; // c', 'const q = /[\'"`]/g; \n'],
    ['holds an escaped bracket and a quote in a class', "const e = /[\\]/']/; // c", "const e = /[\\]/']/; \n"],
    ['follows return', 'return /x\\/\\//; f(); // c', 'return /x\\/\\//; f(); \n'],
    ['follows an opening bracket', 'f(/\\/\\//); // c', 'f(/\\/\\//); \n'],
    ['starts a line', '/\\/\\//.test(x); // c', '/\\/\\//.test(x); \n'],
    ['follows a ternary', 'a ? /x/ : /y\\/\\//; // c', 'a ? /x/ : /y\\/\\//; \n'],
  ])('keeps a regex literal that %s', (_kind, source, stripped) => {
    expect(withoutTsComments(source)).toBe(stripped);
  });

  it.each([
    ['between names', 'a / b // c / x', 'a / b \n'],
    ['after a closing bracket', '(a) / 2 // c / x', '(a) / 2 \n'],
    ['after a closing square bracket', 'x[1] / 2 // c / x', 'x[1] / 2 \n'],
    ['after a number', '10 / 2 // c / x', '10 / 2 \n'],
    ['after a name ending in a keyword', 'areturn / 2 // c / x', 'areturn / 2 \n'],
  ])('reads division %s as division', (_kind, source, stripped) => {
    expect(withoutTsComments(source)).toBe(stripped);
  });

  it('stops a regex literal at the end of its line, so a stray slash cannot swallow the file', () => {
    expect(withoutTsComments('x = /a\n// c\ny')).toBe('x = /a\n\ny');
  });

  // Template literals with ${} (shyden-labs/repo-template#40).
  it.each([
    ['a comment inside ${} (measured 2026-10-22)', 'const t = `${ g() /* note */ }`; // c', 'const t = `${ g()  }`; \n'],
    ['a backtick in a string inside ${} (measured 2026-10-22)', 'const d = `${ "`" }`; // c\nkeep();', 'const d = `${ "`" }`; \nkeep();'],
    ['braces inside ${}, then a comment', 'const o = `${ { a: 1 }.a /* x */ }`; // c', 'const o = `${ { a: 1 }.a  }`; \n'],
    [
      'a template nested inside ${}, then a comment',
      'const n = `a ${ `b ${ c }` /* x */ } d`; // e',
      'const n = `a ${ `b ${ c }`  } d`; \n',
    ],
    ['a regex inside ${}, then a comment', 'const r = `${ /\\/\\//.source /* x */ }`; // c', 'const r = `${ /\\/\\//.source  }`; \n'],
    ['a dollar with no brace', 'const m = `$5 // not a comment`; // c', 'const m = `$5 // not a comment`; \n'],
    ['an escaped ${', 'const s = `\\${ /* text */ }`; // c', 'const s = `\\${ /* text */ }`; \n'],
    ['an escape that ends the file inside a template', 'const u = `abc\\', 'const u = `abc\\'],
  ])('reads %s', (_kind, source, stripped) => {
    expect(withoutTsComments(source)).toBe(stripped);
  });
});
