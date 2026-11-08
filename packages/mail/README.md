# packages/mail

ShyTalk's mail rules, shared by the site Worker (`workers/web/src/mail.ts`) and the doors (`workers/door/src/mail.ts`), so a message is judged and a failure named the same way everywhere (shyden-labs/ShyTalk#88, `docs/superpowers/specs/2026-11-08-email-sender-design.md`).

- `checkMessage(value)`: the message to send, holding only `to`, `subject`, `text` and an optional `html`, or `null`. `to` is one bare address of at most 254 characters; `subject` is 1 to 200 characters with no line break; `text` is not empty; the whole message as JSON is at most `MAIL_MAX_BYTES` (64 KiB). Any other field, a caller-chosen sender included, is dropped.
- `failureFor(error)`: `{ ok: false, reason }` for whatever a send threw, from Cloudflare's `E_*` code alone (kept as `error`); an unknown code is `unknown`. The error's message is never read, since it may echo the address or the body.
- `DOOR_MAIL_PATH` (`/__door/mail`) and `MAIL_SECRET_HEADER` (`x-shytalk-mail-secret`): where dev and test post their mail, and the header carrying that environment's mail secret.
- `EmailSender`: the part of a Workers `send_email` binding ShyTalk uses.
