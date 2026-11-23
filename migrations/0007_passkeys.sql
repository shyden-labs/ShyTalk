-- Passkeys, the authenticator app and recovery codes (plan 7,
-- shyden-labs/ShyTalk#134, docs/superpowers/specs/2026-11-09-passkeys-totp-recovery-design.md).

-- The passkey plugin's table: generated, not hand-written, by Better Auth
-- 1.7.17's own migration compiler (`getMigrations(options).compileMigrations()`
-- from `better-auth/db/migration`) with `@better-auth/passkey` 1.7.17 added to
-- the options in workers/web/src/auth/better-auth.ts, on an empty SQLite. The
-- plugin adds these three statements and changes nothing else (compared
-- 2026-11-11). The server keeps only the public key.
create table "passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);

create index "passkey_userId_idx" on "passkey" ("userId");

create index "passkey_credentialID_idx" on "passkey" ("credentialID");

-- The authenticator app: one live one per member, its secret only as AES-GCM
-- ciphertext under TOTP_KEY. A setup waits in totp_pending until its code is
-- confirmed and its finish batch (after the setup's token is spent) makes it
-- live here, so a refused or cancelled setup never leaves a live authenticator.
CREATE TABLE sign_in_method (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('totp')),
  secret_enc TEXT NOT NULL,
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX sign_in_method_one_per_kind ON sign_in_method (user_id, kind);

CREATE TABLE totp_pending (
  user_id TEXT PRIMARY KEY,
  secret_enc TEXT NOT NULL,
  -- 'session', or the hash of the setup's token: only that flow may confirm it.
  flow TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Ten one-time codes per set, only as SHA-256.
CREATE TABLE recovery_code (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  set_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  used_at INTEGER
);
CREATE INDEX recovery_code_user ON recovery_code (user_id, hash);

-- Wrong tries per address (its keyed hash, so known and unknown addresses do
-- the same work) and kind of code; five lock that kind for 15 minutes, doubled
-- by each lock before (`locks`, up to 16 hours) until a right code.
CREATE TABLE sign_in_lock (
  address_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recovery-code', 'totp')),
  wrong_tries INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  locks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (address_hash, kind)
);
