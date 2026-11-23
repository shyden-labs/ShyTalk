-- No copy of the provider's id token (shyden-labs/ShyTalk#196): Better Auth
-- kept the Google or Apple id token on each account row; ShyTalk verifies it
-- once, at sign-in, and never reads it again. New rows keep none
-- (workers/web/src/auth/better-auth.ts); this empties the rows already stored.
UPDATE account SET idToken = NULL WHERE idToken IS NOT NULL;
