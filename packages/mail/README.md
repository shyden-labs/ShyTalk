# packages/mail

ShyTalk's mail rules and Oracle request signer, used by the site Worker's `sendMail` (`workers/web/src/mail.ts`; shyden-labs/ShyTalk#88, `docs/superpowers/specs/2026-11-08-email-sender-design.md`).

- `checkMessage(value)`: the message to send, holding only `to`, `subject`, `text` and an optional `html`, or `null`. `to` is one bare ASCII address of at most 254 characters; `subject` is 1 to 200 characters with no line break; `text` is not empty; the whole message as JSON is at most `MAIL_MAX_BYTES` (64 KiB). Any other field, a caller-chosen sender included, is dropped.
- `resultFor(status, body, to)`: an Oracle `SubmitEmail` answer as `{ ok: true, messageId }`, or `{ ok: false, reason, status, error? }`. A 200 naming `to` in `suppressedRecipients` is `suppressed`; a 200 without a `messageId` is `unavailable`; any other status goes through `failureFor`.
- `failureFor(status, body)`: 400 `invalid`, 401 `not-authenticated`, 404 `sender-not-approved`, 413 `too-large`, 429 `rate-limit`, 500 and 503 `unavailable`, anything else `unknown`. Oracle's `code` is kept as `error` when it is a plain word, with any leading status (`400 MissingParameter`) dropped; its `message` is never read, since it may echo the address.
- `sign.ts`: `importKey(pem)` (PKCS#8 only, else `null`) and `signRequest(url, body, key, now)`, Oracle's signature version 1 over `(request-target) host date x-content-sha256 content-type content-length` with RSA-SHA256, through WebCrypto alone so it runs in workerd.
