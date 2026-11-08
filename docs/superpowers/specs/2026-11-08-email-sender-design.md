# ShyTalk's email sender: design (#88)

Status: rewritten 2026-11-08 for Oracle Email Delivery. Shyden declined Workers Paid, which Cloudflare Email Sending needs to send to any recipient; ShyTalk makes and checks its own codes (#133) and Oracle carries the mail from the tenancy ShyTalk already uses (`shydenmcm`). Live sends from Singapore, dev and test from London (Shyden, 2026-11-08: "Singapore is always for live and london for dev/test"). DMARC reports go to `dmarc@shyden.co.uk`. The Cloudflare design and PR #141 are superseded.

## Intent

ShyTalk sends its own codes from `no-reply@shytalk.app` through Oracle Email Delivery's HTTPS submission API, called from the Workers it already runs. For now the sender does one job: the email codes for sign-up and recovery (#133; the website's #60 uses the same sender). Closed-testing confirmations (#55) reuse it later.

## Goals

- One function, `sendMail(env, {to, subject, text, html})`, answering `{ok: true, messageId}` or `{ok: false, reason}`. It never throws for a send failure and never logs the body (a code is a secret).
- Live can send only as `no-reply@shytalk.app`, dev and test only as `no-reply@dev.shytalk.app`: each environment signs with its own Oracle user and key, and that user's policy allows one approved sender in one compartment.
- SPF, DKIM and DMARC pass at Gmail and Outlook (headers read, #88 AC3).
- A caller shows a failure as a failure, never "check your email" (#88 AC4; the callers #133, #60 and #55 test their own screens).

## Non-goals

- No marketing mail, newsletters or bulk sends; one recipient per message.
- No inbound mail (support mail is Shyden Labs' shared support system, decision 225).
- No retry wrapper (global rule: a retry is not a fix). A failed send is reported with its reason.
- No Oracle SDK in the Worker: the request is signed with WebCrypto.

## Measured facts (docs.oracle.com and Oracle's generated SDK source, read 2026-11-08)

- **Operation:** `SubmitEmail`, `POST https://cell0.submit.email.{region}.oci.oraclecloud.com/20220926/actions/submitEmail` (`email_dp_client.py` in `oracle/oci-python-sdk`: endpoint template `https://cell0.submit.email.{region}.oci.{secondLevelDomain}`, base path `/20220926`, resource path `/actions/submitEmail`). Both hosts read from the console's Configuration page on 2026-11-08: `cell0.submit.email.ap-singapore-1.oci.oraclecloud.com` and `cell0.submit.email.uk-london-1.oci.oraclecloud.com`, port 443.
- **Body:** `{"sender": {"senderAddress": {"email", "name"?}, "compartmentId"}, "recipients": {"to": [{"email"}]}, "subject", "bodyText"?, "bodyHtml"?}`; at least one body; at most 50 recipients; `email` is ASCII only. **Answer:** `{messageId, envelopeId, suppressedRecipients}`, all required.
- **Signing** (Request Signatures page): `Authorization: Signature version="1",keyId="<tenancy>/<user>/<fingerprint>",algorithm="rsa-sha256",headers="(request-target) host date x-content-sha256 content-type content-length",signature="…"`; a POST signs at least those six headers; `x-content-sha256` is the base64 SHA-256 of the body; a clock more than 5 minutes out answers 401. RSA-SHA256 is WebCrypto's `RSASSA-PKCS1-v1_5` with `SHA-256`, which Workers support.
- **Errors:** the per-operation error table is in Oracle's JavaScript API reference, which could not be read as text. The generic table (API Errors page): 400 `InvalidParameter`/`MissingParameter`/`LimitExceeded`, 401 `NotAuthenticated`, 404 `NotAuthorizedOrNotFound`, 413 `PayloadTooLarge`, 429 `TooManyRequests`, 500 `InternalServerError`, 503 `ServiceUnavailable`. Measured 2026-11-08: a non-approved sender answers 404 and a wrong key fingerprint 401, and this endpoint's `code` leads with the status (`"400 MissingParameter"`), so `failureFor` keeps the word after it.
- **Approved senders:** every `From:` address must be an approved sender, which belongs to one compartment and exists only in the region it was made in ("if you create an approved sender in the US West (Phoenix) region, you can't send email through the US East (Ashburn) region"). Not in the root compartment.
- **Limits:** paid tenancies (this one is: the Singapore A1.Flex VM is not Always Free) 50,000 a day, 18,000 a minute, 2 MB a message; each recipient counts as one email. Always Free: "you can send 3000 emails for free per month"; the Always Free page says its resources are free "in the home region of the tenancy" (London) and the email line names no region, so whether Singapore's live mail is inside the free 3,000 is unproven: AC5 below reads the first month's bill.
- **DNS:** DKIM is a CNAME Oracle generates per email domain (selector chosen by us, two keys at most, one active). SPF: Asia/Pacific `include:ap.rp.oracleemaildelivery.com`, Europe `include:eu.rp.oracleemaildelivery.com`. Today `shytalk.app` and `dev.shytalk.app` carry no TXT, MX or `_dmarc` record (`dig`, 2026-11-08), so nothing clashes.
- **IAM:** `use approved-senders` grants `APPROVED_SENDER_USE`; conditions can name `target.approved-sender.emailaddress`. The policy reference lists `SmtpSend` under that permission and does not name `SubmitEmail`: measured 2026-11-08: the narrowed dev policy lets HTTPS submission through, and the dev key sending as `no-reply@shytalk.app` is refused (404) in both regions.

## The how

| | Live | Dev | Test |
| --- | --- | --- | --- |
| Region | `ap-singapore-1` | `uk-london-1` | `uk-london-1` |
| Compartment (existing, made 2026-11-07) | `shytalk-prod` | `shytalk-dev` | `shytalk-dev` |
| Email domain + approved sender | `shytalk.app`, `no-reply@shytalk.app` | `dev.shytalk.app`, `no-reply@dev.shytalk.app` | the dev sender |
| Oracle user (API key only, no console password) | `shytalk-mail-live` | `shytalk-mail-dev` | `shytalk-mail-test` |

- **Policies**, one per user's group, in the root compartment: `Allow group 'OracleIdentityCloudService'/'shytalk-mail-<env>' to use approved-senders in compartment <compartment> where target.approved-sender.emailaddress = '<sender>'`. No user can manage senders, domains or keys. Users live in the `OracleIdentityCloudService` identity domain, capabilities API keys only, email `support@shytalk.app` (Oracle requires one).
- **Keys:** each RSA 2048 key pair is generated on Shyden's Mac (`openssl genpkey`, PKCS#8) into `~/.config/shyden/oci/shytalk-mail-<env>.pem` (mode 600); only the public key is pasted into Oracle, and the fingerprint Oracle shows is checked against the local one.
- **Worker secrets** (per Cloudflare environment, never in git): `OCI_TENANCY`, `OCI_USER`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY` (PKCS#8 PEM), `OCI_COMPARTMENT`. Plain vars in `wrangler.json`: `MAIL_REGION`, `MAIL_FROM`. Each environment's five values live in its own GitHub environment (`dev`, `test`, `production`; set 2026-11-08 by `.superpowers/sdd/88/set-oci-secrets.zsh` after Shyden granted the ShyTalk App `environments: write`), and the deploy puts them into its Worker in a last step of their own (#145). Live's sit in `production`, so every deploy that can use them waits for Shyden's approval. Dev and test never hold live's key, so dev cannot send as live.
- **`packages/mail`** (kept from the reference branch `feat/88-email-sender`): `checkMessage` (one bare address, subject without line breaks, 64 KiB cap) and the reasons type. New: `signRequest(request, key)` producing the six signed headers, and `failureFor(status, body)`.
- **Reasons:** 400 → `invalid`, 401 → `not-authenticated`, 404 → `sender-not-approved`, 413 → `too-large`, 429 → `rate-limit`, 500/503 or a network failure → `unavailable`; a 200 whose `suppressedRecipients` holds the recipient → `suppressed`; anything else → `unknown`, with the status and Oracle's `code` (never its `message`, which may echo the address) kept in the audit row.
- **Audit:** every send writes one row (`mail.sent` with the `messageId`, or `mail.failed` with the reason), without the recipient, the subject, the code or the body (#60 AC3; the `audit` table refuses DELETE, so an address there could never be removed as the privacy policy promises).
- **DNS** (Cloudflare, `shytalk.app` zone in the PROD account): `shytalk.app TXT "v=spf1 include:ap.rp.oracleemaildelivery.com ~all"`, `dev.shytalk.app TXT "v=spf1 include:eu.rp.oracleemaildelivery.com ~all"`, each domain's DKIM CNAME, and `_dmarc` on both: `v=DMARC1; p=quarantine; rua=mailto:dmarc@shyden.co.uk`, to `p=reject` after two clean weeks. Reports to another domain need that domain's consent record (RFC 7489 section 7.1): `shytalk.app._report._dmarc.shyden.co.uk TXT "v=DMARC1"` (and the same for `dev.shytalk.app`), and the `dmarc@shyden.co.uk` mailbox must exist.
- **Tests:** unit tests stand in `fetch` and the clock: the signing string and header set for a known key and body, checked against a signature made by Node's own `crypto.sign` for the same input; each status to its reason; the suppressed answer; no address, code or body in any log line. No CI test sends mail: AC3 is proven by one measured send per environment to a Gmail and an Outlook inbox, headers saved as evidence on #88, so no test spends the allowance. The deploy workflows hold each environment's key only to put it into that Worker (see Worker secrets above).

## Set-up state (2026-11-08)

Done in Shyden's console at his request and read back: both email domains, DKIM keys (pending DNS), approved senders in their compartments, the three users, groups and policies, and the keys. Done at shyden.co.uk: the `dmarc@shyden.co.uk` mailbox and both consent records.

## Steps that are Shyden's (his identity and his console)

1. The `shytalk.app` DNS records above in the PROD Cloudflare account, then read back with `dig`; then DKIM is activated in Oracle.
2. Production approval of the live deploy that adds the sender.
3. After the first month with live mail: the tenancy's bill for Email Delivery, read for AC5.
