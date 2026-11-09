# Closed-testing applicant requests

A person who asks gets a truthful answer and deletion (design section 3, item 5; UU 27/2022 Pasal 7-8, GDPR Art. 15 and 17). Requests arrive by email at support@shytalk.app and are done by hand until release 3b adds a screen.

Both commands read or change the live database, so they use the live Cloudflare account's credentials and are run by Shyden. Replace `person@example.test` with the address, lower case and with no spaces, as the form stores it. The address never goes in the audit row.

## "Do you hold my email?"

```sh
npx wrangler d1 execute shytalk-prod --remote --env prod --config workers/web/wrangler.json \
  --command "SELECT email, locale, applied_at, confirmed_at FROM applicants WHERE email = 'person@example.test'; INSERT INTO audit (at, actor, action, environment) VALUES (unixepoch() * 1000, 'staff:owner', 'applicant.looked_up', 'prod')"
```

No row means the address is not held. `applied_at` and `confirmed_at` are milliseconds since 1970. An unconfirmed row goes by itself 48 hours after applying, on the next write to the table.

## Delete it

```sh
npx wrangler d1 execute shytalk-prod --remote --env prod --config workers/web/wrangler.json \
  --command "DELETE FROM applicants WHERE email = 'person@example.test'; INSERT INTO audit (at, actor, action, environment) VALUES (unixepoch() * 1000, 'staff:owner', 'applicant.deleted', 'prod')"
```

Run the first command again to see that no row is left, then answer the person.

## The rate limit's terms

Read from Cloudflare's [rate limit binding page](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) on 2026-11-09 (page dated 2026-10-21) for `APPLY_LIMIT`, 5 a minute per IP:

- The period must be 10 or 60 seconds.
- The page names no plan and no price, so it does not say what the Free plan gets. ShyTalk's `wrangler.json` already binds `SIGN_IN_LIMIT` the same way on the same accounts.
- The limit is approximate and per Cloudflare location: requests can pass it while counts update, and two locations count separately. The strict alternative it names is a Durable Object.
- It advises against an IP as the key, because many people can share one. The form has no sign-in or other identity to use instead, so the key stays the IP: people sharing an address may wait a minute and try again.
