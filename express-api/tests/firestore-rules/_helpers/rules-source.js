'use strict';

/**
 * The one place every emulator rules test reads its rules from (SHY-0657).
 *
 * With no override this is the repo's live `firestore.rules`. The red-first
 * CI step (`scripts/ci/rules-red-first.js`) sets SHYTALK_RULES_UNDER_TEST to
 * the base branch's rules, as test input only, to show each new DENY test
 * fails there; the live file is never swapped out. An override that names
 * nothing, or an empty file, throws rather than run against no rules.
 */

const fs = require('fs');
const path = require('path');

const RULES_OVERRIDE_ENV = 'SHYTALK_RULES_UNDER_TEST';
const LIVE_RULES_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'firestore.rules');

function rulesPath({ env = process.env, exists = fs.existsSync } = {}) {
  const override = env[RULES_OVERRIDE_ENV];
  if (override === undefined) return LIVE_RULES_PATH;
  if (override === '') throw new Error(`${RULES_OVERRIDE_ENV} is set but empty`);
  if (!exists(override)) {
    throw new Error(`${RULES_OVERRIDE_ENV} names ${override}, which does not exist`);
  }
  return override;
}

function loadRules({ env = process.env, exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  const file = rulesPath({ env, exists });
  const text = readFile(file, 'utf8');
  if (text.trim() === '') throw new Error(`${file} is empty`);
  return text;
}

module.exports = { RULES_OVERRIDE_ENV, LIVE_RULES_PATH, rulesPath, loadRules };
