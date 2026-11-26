# DEV pass, open TEST and a sign-up switch: design (shyden-labs/ShyTalk#314)

Approved by Shyden on 2026-11-27. This covers the website half of #314. The app half is shyden-labs/ShyTalk#384, which waits on the first app build (#77).

## Why

Shyden's rulings of 2026-11-22, which apply to every project:

- Only DEV keeps a gate, and it must be "impossible to steal, not hard to steal". No build carries a password, encrypted or not.
- TEST is the beta that looks like production, "what we intend to release". Members use their own accounts and there is no password box.
- Every environment, production included, gets "a very simple toggle" that turns organic sign-ups off and on.

At the moment, DEV and TEST both ask for the shared site password (#262), and DEV also takes the partner site's one-use pass (#263). Plan 6.1's app could only get in by carrying a secret.

## Goals

1. dev.shytalk.app's door lets in only a valid DEV pass, using repo-template's pattern (`docs/dev-pass.md` and `scripts/dev-pass/` on repo-template's develop, shyden-labs/repo-template#207).
2. DEV and TEST no longer ask for the site password, and the partner pass is removed. Their secrets (`SITE_PASSWORD`, `DEV_PASS_SECRET`) are removed from every workflow and environment.
3. Machines (CI and phone runs) get a 1-hour machine pass from `POST https://dev-signin.shyden.co.uk/machine?for=dev.shytalk.app`, using the Cloudflare Access service token `shytalk CI dev`. Its ID and secret are kept only in GitHub's `dev` environment (`DEV_ACCESS_CLIENT_ID`, `DEV_ACCESS_CLIENT_SECRET`) and in this Mac's Keychain (`shytalk-ci-dev-access-client-id`, `shytalk-ci-dev-access-client-secret`, account `shytalk`). The token was created on 2026-11-27 and attached to the dev-signin Access application through the `shytalk CI` Service Auth policy.
4. A sign-up switch per environment, set by a GitHub environment variable `SIGNUPS_OPEN` (`true` or `false`) and applied by that environment's deploy. When it is `false`, the sign-up page and the sign-up API both refuse a new account and say that new sign-ups are closed. Sign-in keeps working.
5. The smoke checks for the ShyDesk support widget run against the real dev.shytalk.app after each dev deploy, signed in with CI's machine pass. They move out of the pull-request smoke.

## Non-goals

- The app's sign-in to DEV and the search of built app files (#384).
- Changing ShyDesk's allowed list, or adding CI's local address to it.
- Any change to the sign-in Worker (shyden.co.uk's), apart from what that session does for shyden.co.uk#1307.

## Anti-goals

- Any secret in a build or a commit that opens DEV.
- A fake stand-in for ShyDesk's widget in the smoke (the 2026-10-31 rule: tests are as real as their kind allows).

## Constraints

- dev.shytalk.app's door holds only the public key: `kid` `2026-11`, `x` `OBLprb_S4Kn2C--HFVaeA3_s6gEsApDiRAWPLc6WsK8`. The shyden-co-uk-c0 session read both from the deployed sign-in (`workers/dev-signin/config.ts:31`, `wrangler.jsonc` `DEV_PASS_KID`). They are a plain variable, not a secret.
- The sign-in's host map already lists `dev.shytalk.app` (`appRedirects: []`). Measured: `/pass?for=dev.shytalk.app` forwards to `https://dev.shytalk.app/__devpass/accept`.
- The origin keeps requiring its door secret, so the `workers.dev` addresses stay closed (design 4.17). CI and automated API tests keep calling the origin directly with the door secret, as the pattern says in step 5.
- People never open `workers.dev`, because Indonesia blocks it.
- Strict TDD: every test is red by name before its code exists. Tests that only CI can run are red on CI first.

## Approaches

- **Chosen: adopt repo-template's door as it stands.** Copy `pass.ts`, `door.ts` and `form.ts` into `workers/door/src/dev-pass/`, citing shyden-labs/repo-template#207. The DEV door runs `handleDevDoor` in front of `forward`. Its `signin` is set to fetch through `dev-signin.shyden.co.uk`, so ShyDesk's widget can swap the page's pass for a 5-minute embed pass. The TEST door keeps forwarding with no check. One pattern runs across every product, and ShyTalk carries no gate code of its own.
- *Keep the gate in the origin (`workers/web`).* Rejected: the origin is the `workers.dev` service, and the pattern puts the check at the door so that nothing past the door ever sees a pass.
- *Keep the site password on DEV and add the pass alongside it.* Rejected: a shared password in builds is what the ruling removes.

Widget smoke (Shyden, 2026-11-27, "Check after dev deploy"): after shydesk#302, ShyDesk DEV answers only pages on its allowed list that hold a pass. CI's local address (https://127.0.0.1) is on neither, so the widget checks move to a post-deploy run against dev.shytalk.app. The cost is that a widget break shows up after the merge to develop, not on the pull request.

Sign-up switch (Shyden, 2026-11-27, "Setting in GitHub"): a variable is chosen over a live stored flag. It means nothing new to build or secure. Flipping it means a redeploy, and production still needs Shyden's approval.

## Blockers and waits

- AC3 (machines) and the post-deploy widget smoke wait on shyden.co.uk#1307. Measured at 01:53 WIB on 2026-11-27: `/machine` answers 401 with an empty body for the allowed `shytalk CI dev` token, the same failure as shyden.co.uk's own CI token. It is linked as a blocker of #314.
- shydesk#302 is held off DEV until ShyTalk messages ShyDesk that the door and the machine pass are live.
- PROD's switch reading needs a production release, which Shyden approves.

## Left to the builder

- How the door's settings are named in `wrangler.json` (vars `DEV_PASS_KEYS`, `HOST`) and which tests cover them.
- How the post-deploy smoke gets its machine pass: a step that mints it and hands it to Playwright as `X-Dev-Pass` and the cookie.
- The exact copy for "new sign-ups are closed" in the 5 site languages. Each line is read back by Google before it is committed.
