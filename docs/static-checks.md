# Static checks: typecheck, lint, format

Every code file is typechecked, linted and format-checked (issue shyden-labs/repo-template#61). A
finding fails the build: CI's required `build-and-test` job runs each one as a
named step, after the install (`scripts/npm-ci.ts`) and before the unit suite, and `.githooks/pre-push`
runs the same three before every push.

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit -p .` over every `.ts` and `.js` file |
| `npm run lint` | ESLint with no warnings allowed |
| `npm run format:check` | Prettier's check; `npm run format` rewrites |

`npm install` (or `npm ci`) installs the hook: the `prepare` script points
git's `core.hooksPath` at `.githooks`. The hook runs no test suite: run
`npm run test:unit` by hand before each push, and leave every other suite to CI.

## Settings, and why

- **`tsconfig.json`** is `strict`, with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Node runs these files by stripping types, so
  nothing is emitted and only erasable syntax is allowed
  (`erasableSyntaxOnly`). Relative imports name their `.ts` file, as Node
  needs (`nodenext`).
- **`eslint.config.js`** applies `@eslint/js` recommended and
  typescript-eslint's `strictTypeChecked`, with type information. An unused
  disable comment is an error. Two options are named, and nothing else is
  loosened:
  - `restrict-template-expressions` allows numbers (`` `line ${n}` ``). Every
    other option is spelled out `false`: options given here replace the
    preset's, and the rule's own defaults would allow `null`.
  - `no-unused-vars` ignores rest siblings, so `{ key: _key, ...rest }` can
    leave a key out of a copy.
  The config is `.js` because ESLint needs the `jiti` package to load a `.ts`
  config.
- **`.prettierrc.json`** formats at width 140 with single quotes. The width was
  measured: over every code and config file, 140 changed the fewest lines
  (1,623, against 1,625 at 160, 2,016 at 120 and 3,176 at 100).
  `.prettierignore` leaves out files that tools write (`package-lock.json`,
  `coverage/`) and Markdown, which is prose kept as written.

## When a check finds something

Fix it in the code. A disable comment, a `@ts-ignore` or an `as any` hides the
finding; a cast is used only to state an invariant the types cannot see, with a
comment saying what it is.

No exemption exists: a disable comment, or a rule loosened in
`eslint.config.js`, needs the operator's ruling first.

`tests/unit/static-checks.test.ts` pins the scripts, the CI steps, the hook and
these settings; `tests/unit/lint-config.test.ts` pins the lint config's own
choices.
