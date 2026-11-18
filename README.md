# ShyTalk

Learn languages and cultures by talking.

Progress to launch: [ShyTalk: the road to launch](https://claude.ai/artifact/K58mvus5Tnn6e1D25KvLYT).

ShyTalk is a friendly place to learn languages and cultures by talking with people around the world. It is about language and cultural exchange, never dating, and strict community rules keep it welcoming for every learner. ShyTalk is made by Shyden Labs ([shyden.co.uk](https://shyden.co.uk)); the app is coming to the App Store and Google Play, and the website to [shytalk.app](https://shytalk.app).

## Where things live

| Folder | What it holds |
| --- | --- |
| `apps/web` | The website (Astro): the home page, closed testing, sign-up, sign-in, the account page and the legal pages, in English, Indonesian, Thai, Vietnamese and Chinese. |
| `workers/web` | The site's Cloudflare Worker: it serves the built pages and answers `/api/*`, including sign-in (Better Auth), passkeys, authenticator apps, recovery codes and the closed-testing form. |
| `workers/door` | The front doors at test.shytalk.app and dev.shytalk.app: each passes every request to its environment's Worker with that environment's door secret, which the Worker requires. |
| `packages/environment` | The checks every Worker shares: the door secret, the dev and test site password, and the marker that ties each Worker to its own database. |
| `packages/mail` | The rules for the mail ShyTalk sends, and how a send's result is read. |
| `packages/ui-document` | The app's UI document (menus, colours, sizes and words sent by the server) and its validation. |
| `migrations` | The database (Cloudflare D1) migrations, applied by each deploy. |
| `tests/unit` | Unit tests: fast, in-process, with every outside service stood in. |
| `tests/integration`, `tests/smoke`, `tests/phones` | Integration tests, the browser smoke suite (Chromium, Firefox and WebKit) and the real-phone runs. |
| `scripts` | Tools for CI, the dependency audit, releases and the project board. |
| `docs` | How the board, release cuts, SonarCloud and the static checks work. |
| `brand` | The ShyTalk icon and wordmark. |

## Checks

Install, then run the checks this Mac runs. Every other suite runs in CI through a pull request.

```sh
node scripts/npm-ci.ts   # install exactly what package-lock.json names
npm run test:unit        # unit tests
npm run typecheck        # TypeScript, strict
npm run lint             # ESLint, no warnings allowed
npm run format:check     # Prettier
```

Work happens on one branch per ticket from `develop`, squash-merged once CI is green; production gets only a frozen release cut (`docs/release-cut.md`). Tickets live on the [ShyTalk Stories board](https://github.com/orgs/shyden-labs/projects/5) (`docs/project-board.md`).

## Licence

Code: Apache-2.0 (`LICENSE`, `NOTICE`). The ShyTalk name and brand: see `TRADEMARKS.md`.
