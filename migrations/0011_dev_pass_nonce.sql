-- shyden-labs/ShyTalk#263: each dev pass from the partner site's link works once. A pass's nonce is
-- kept until its expiry (unix seconds); workers/web/src/dev-pass-gate.ts records it and forgets expired
-- ones in the same batch, no clock. Only DEV takes passes; the table stays empty elsewhere.
CREATE TABLE dev_pass_nonce (
  nonce TEXT PRIMARY KEY NOT NULL,
  exp INTEGER NOT NULL
);
CREATE INDEX dev_pass_nonce_exp ON dev_pass_nonce (exp);
