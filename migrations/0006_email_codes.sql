-- Email codes at sign-up and for recovery (plan 6, shyden-labs/ShyTalk#133,
-- docs/superpowers/specs/2026-11-11-email-code-sign-up-recovery-design.md).
-- No address, code or token is stored plain: addresses and codes as keyed
-- HMAC-SHA256, tokens as SHA-256. The one plain address, a sign-up token's
-- confirmed address, lives at most 30 minutes.

-- One live code per address and purpose.
CREATE TABLE email_code (
  id INTEGER PRIMARY KEY,
  address_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('sign-up', 'recovery')),
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  wrong_tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX email_code_address ON email_code (address_hash, purpose);
CREATE INDEX email_code_expiry ON email_code (expires_at);

-- One row per start, kept 24 hours: the per-address limits count these.
CREATE TABLE email_send (
  address_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX email_send_address ON email_send (address_hash, at);
CREATE INDEX email_send_at ON email_send (at);

-- Sign-up tokens hold the confirmed address; recovery tokens hold the member.
CREATE TABLE one_time_token (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('sign-up', 'recovery')),
  user_id TEXT,
  email TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX one_time_token_expiry ON one_time_token (expires_at);
CREATE INDEX one_time_token_user ON one_time_token (user_id, purpose);

-- At most one pending recovery per member.
CREATE TABLE account_recovery (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completes_at INTEGER NOT NULL,
  cancel_token_hash TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'cancelled', 'completed')),
  ended_at INTEGER
);
CREATE UNIQUE INDEX account_recovery_one_pending ON account_recovery (user_id) WHERE state = 'pending';
