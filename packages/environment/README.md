# packages/environment

The origin side of the front doors (design 4.17, shyden-labs/ShyTalk#28). Each TEST and DEV origin Worker uses both checks before it serves a request.

- `requireDoorSecret(request, configured)`: `null` when the request carries the environment's door secret in `x-shytalk-door-secret`, otherwise a plain 403. Both values are hashed with SHA-256 and the digests compared in constant time, so neither length nor content leaks through timing. An unset or empty configured secret refuses everything.
- `createMarkerGuard(expected, { databases, buckets }).assertEnvironmentMarkers()`: `null` when every D1 database and R2 bucket names `expected`, otherwise a plain 503 and one logged line naming the store. Make one guard per isolate (at module scope): a pass is kept for the isolate's life, and a failure is checked again on the next request. Given no store at all, it fails.

## The markers

Each D1 database holds a one-row `environment_marker` table and each R2 bucket a `.environment` object, both holding the environment's name (`test`, `dev` or `prod`). Create them once per store, signed in to that environment's Cloudflare account. For example, in DEV:

```sh
npx wrangler d1 execute <database> --remote --command "CREATE TABLE environment_marker (name TEXT NOT NULL); INSERT INTO environment_marker (name) VALUES ('dev');"
printf 'dev' > .environment
npx wrangler r2 object put <bucket>/.environment --remote --file .environment
rm .environment
```

Read them back with `npx wrangler d1 execute <database> --remote --command "SELECT name FROM environment_marker"` and `npx wrangler r2 object get <bucket>/.environment --remote --pipe`.
