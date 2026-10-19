// PLANT (do not merge): SHY-0648 per-clause mutation run.
// Each mutant changes one exact piece of firestore.rules (found exactly once),
// runs the conversations rules suite against it, and compares the red tests
// with the prediction written before CI ran. Mutants are a runtime list, so
// they are looped here, in a plant script, not inside a test.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RULES = join(ROOT, 'firestore.rules');
const API = join(ROOT, 'express-api');
const SUITE = 'tests/firestore-rules/conversations-rules.test.js';
const original = readFileSync(RULES, 'utf8');

const T = {
  d1: 'DENY: a member sets themselves as owner',
  d2: 'DENY: a member puts themselves in groupAdminIds',
  d3: 'DENY: a member puts themselves in groupModIds',
  d4: 'DENY: a member removes another member (whoCanRemoveMembers ADMINS_ONLY)',
  d5: 'DENY: a member removes the owner',
  d6: 'DENY: a member closes the group',
  d7: "DENY: a member rewrites the group's permissions",
  d8: "DENY: a member changes the group's system messages",
  d9: "DENY: a member changes the group's mod notify mode",
  d10: "DENY: a member changes the group's cohort",
  d11: 'DENY: a member turns the group into a one-to-one',
  d12: 'DENY: a member renames the group when whoCanEditInfo is ADMINS_ONLY',
  d13: 'DENY: a mod puts themselves in groupAdminIds',
  d14: 'DENY: an admin who is not the owner sets themselves as owner',
  d15: 'DENY: a one-to-one participant turns the thread into a group they run',
  d16: 'DENY: the owner hands ownership to someone outside the group',
  e1: 'DENY: a one-to-one participant adds a third person',
  e2: 'DENY: a member writes a field the apps never write',
  e3: 'DENY: even the owner writes a field the apps never write',
  e4: 'DENY: a mod closes the group',
  e5: 'DENY: a member adds a user when whoCanAddMembers is ADMINS_ONLY',
  e6: 'DENY: nobody removes the owner, even when whoCanRemoveMembers is EVERYONE',
  e7: 'DENY: with no permissions map a member removes another (default ADMINS_ONLY)',
  e8: 'DENY: an admin renames and promotes in one write (needs the owner for both)',
  a2: 'ALLOW: the owner makes a member an admin (updateGroupRoles)',
  a3: 'ALLOW: the owner hands ownership to a member (transferOwnership)',
  a5: 'ALLOW: an admin closes the group (closeGroupConversation)',
  a6: "ALLOW: the owner changes the group's permissions",
  b1: 'ALLOW: an admin adds a user when whoCanAddMembers is ADMINS_ONLY',
  b3: 'ALLOW: an admin who is not the owner removes a member (ADMINS_ONLY)',
  b4: 'ALLOW: the owner removes a member (ADMINS_ONLY)',
  b5: 'ALLOW: a mod removes a member when whoCanRemoveMembers is MODS_AND_ABOVE',
  b6: 'ALLOW: a mod removes a member under the old name ADMINS_AND_MODS',
  b10: 'ALLOW: the owner changes system messages, notify mode, description and photo',
  f1: 'DENY: a one-to-one participant removes the other person',
  f2: 'DENY: a member removes another when whoCanRemoveMembers is MODS_AND_ABOVE',
  f3: 'DENY: an admin renames the group when whoCanEditInfo is OWNER_ONLY',
  f4: 'ALLOW: the owner renames the group when whoCanEditInfo is OWNER_ONLY',
  f5: 'DENY: an unknown level reads as its default (a member removes another)',
};
const ALL_DENY = Object.entries(T)
  .filter(([, title]) => title.startsWith('DENY:'))
  .map(([k]) => k);

// [id, what is dropped, find, replace, predicted red test keys]
const MUTANTS = [
  ['M01', 'group allow-list of fields',
    "changed.hasOnly(['participantIds', 'groupName', 'groupDescription',\n                                'groupPhotoUrl', 'isClosed', 'groupAdminIds',\n                                'groupModIds', 'createdBy', 'permissions',\n                                'systemMessageConfig', 'modNotifyMode'])",
    'true',
    ['d10', 'd11', 'e2', 'e3']],
  ['M02', 'owner-only for owner, roles, permissions, system messages, notify mode',
    '              || isGroupOwner())', '              || true)',
    ['d1', 'd2', 'd3', 'd7', 'd8', 'd9', 'd13', 'd14', 'e8']],
  ['M03', 'a new owner must be in the group',
    '|| request.resource.data.createdBy in request.resource.data.participantIds)', '|| true)',
    ['d16']],
  ['M04', 'closing needs an admin',
    "(!('isClosed' in changed) || isGroupAdmin())", "(!('isClosed' in changed) || true)",
    ['d6', 'e4']],
  ['M05', 'name, description and photo follow whoCanEditInfo',
    "|| permissionAllows('whoCanEditInfo', 'EVERYONE'))", '|| true)',
    ['d12', 'f3']],
  ['M06', 'adding follows whoCanAddMembers',
    "(added.size() == 0 || permissionAllows('whoCanAddMembers', 'EVERYONE'))",
    '(added.size() == 0 || true)',
    ['e5']],
  ['M07', 'removing follows whoCanRemoveMembers',
    "(permissionAllows('whoCanRemoveMembers', 'ADMINS_ONLY')", '(true',
    ['d4', 'e7', 'f2', 'f5']],
  ['M08', 'nobody removes the owner',
    "&& !(resource.data.get('createdBy', '') in removed)));", '&& true));',
    ['e6']],
  ['M09', 'group: removing anyone but yourself is judged',
    '&& (leavingOnly', '&& (true',
    ['d4', 'd5', 'e6', 'e7', 'f2', 'f5']],
  ['M10', 'one-to-one: only participantIds may change',
    "&& changed.hasOnly(['participantIds'])", '&& true',
    ['d15']],
  ['M11', 'one-to-one: nobody is added',
    '              && added.size() == 0', '              && true',
    ['e1']],
  ['M12', 'one-to-one: a participant removes only themselves',
    '              && leavingOnly);', '              && true);',
    ['f1']],
  ['M13', 'group rules apply only to groups',
    "return (resource.data.get('isGroup', false) == true", 'return (true',
    ['e1']],
  ['M15', 'MODS_AND_ABOVE needs a mod',
    "(level in ['MODS_AND_ABOVE', 'ADMINS_AND_MODS'] && isGroupStaff())",
    "(level in ['MODS_AND_ABOVE', 'ADMINS_AND_MODS'] && true)",
    ['f2']],
  ['M16', 'ADMINS_ONLY needs an admin',
    "(level == 'ADMINS_ONLY' && isGroupAdmin())", "(level == 'ADMINS_ONLY' && true)",
    ['d4', 'd12', 'e5', 'e7', 'f5']],
  ['M17', 'OWNER_ONLY needs the owner',
    "(level == 'OWNER_ONLY' && isGroupOwner())", "(level == 'OWNER_ONLY' && true)",
    ['f3']],
  ['M18', 'an unknown level reads as its default',
    '|| (!(level in known) && levelAllows(fallback))', '|| (!(level in known) && true)',
    ['f5']],
  ['M19', 'a known level is judged',
    '(level in known && levelAllows(level))', '(level in known && true)',
    ['d4', 'd12', 'e5', 'e7', 'f2', 'f3']],
  ['M20', 'a mod is someone in groupModIds (tightened)',
    "|| string(callerUniqueId()) in resource.data.get('groupModIds', []);", '|| false;',
    ['b5', 'b6']],
  ['M21', 'an admin is someone in groupAdminIds (tightened)',
    "|| string(callerUniqueId()) in resource.data.get('groupAdminIds', []);", '|| false;',
    ['a5', 'b1', 'b3']],
  ['M22', 'the owner is createdBy (tightened)',
    "return string(callerUniqueId()) == resource.data.get('createdBy', '');", 'return false;',
    ['a2', 'a3', 'a6', 'b4', 'b10', 'f4']],
  ['M23', 'the whole SHY-0648 check',
    '&& conversationChangeAllowed();', ';',
    ALL_DENY],
  ['M24', 'the old level name ADMINS_AND_MODS (tightened)',
    "(level in ['MODS_AND_ABOVE', 'ADMINS_AND_MODS'] && isGroupStaff())",
    "(level in ['MODS_AND_ABOVE'] && isGroupStaff())",
    ['b6']],
  ['M25', 'groupPhotoUrl in the allow-list (tightened)',
    "'groupPhotoUrl', 'isClosed',", "'isClosed',",
    ['b10']],
  ['M26', 'OWNER_ONLY lets the owner (tightened)',
    "(level == 'OWNER_ONLY' && isGroupOwner())", "(level == 'OWNER_ONLY' && false)",
    ['f4']],
];
// Left out, and why: dropping the one-to-one branch's isGroup check lets a
// group also pass the one-to-one rule, whose only allowed change (leave,
// nobody added) the group rule already allows: an equivalent mutant.

function runSuite(label) {
  const out = join(API, `mutant-${label}.json`);
  try {
    execFileSync(
      process.execPath,
      ['--experimental-vm-modules', 'node_modules/.bin/jest', SUITE, '--json',
       `--outputFile=${out}`, '--forceExit'],
      { cwd: API, stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch {
    // jest exits non-zero when a test is red; the JSON report is the verdict.
  }
  const report = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(out);
  const results = report.testResults.flatMap((f) => f.assertionResults);
  return {
    total: results.length,
    red: results.filter((r) => r.status !== 'passed').map((r) => r.title).sort(),
  };
}

if (process.argv.includes('--counts')) {
  // Applies nothing and runs nothing: shows each find occurs exactly once.
  for (const [id, , find] of MUTANTS) {
    console.log(`${id} ${original.split(find).length - 1}`);
  }
  process.exit(0);
}

const lines = [];
let failed = false;
const base = runSuite('baseline');
lines.push(`baseline: ${base.total} tests, ${base.red.length} red`);
if (base.red.length || base.total === 0) {
  lines.push(`  BASELINE NOT GREEN: ${base.red.join(' | ')}`);
  failed = true;
}

for (const [id, what, find, replace, predicted] of MUTANTS) {
  const count = original.split(find).length - 1;
  if (count !== 1) {
    lines.push(`${id} NOT APPLIED: found ${count} times: ${find}`);
    failed = true;
    continue;
  }
  writeFileSync(RULES, original.replace(find, replace));
  let r;
  try {
    r = runSuite(id);
  } finally {
    writeFileSync(RULES, original);
  }
  const want = predicted.map((k) => T[k]).sort();
  const extra = r.red.filter((t) => !want.includes(t));
  const missing = want.filter((t) => !r.red.includes(t));
  const verdict = r.red.length ? 'KILLED' : 'SURVIVED';
  const match = extra.length || missing.length ? 'DIFFERS FROM PREDICTION' : 'as predicted';
  lines.push(`${id} ${verdict} (${r.red.length} red of ${r.total}; ${match}): drops ${what}`);
  if (r.total !== base.total) lines.push(`  TOTAL MOVED: ${base.total} -> ${r.total}`);
  for (const t of r.red) lines.push(`  red: ${t}`);
  for (const t of extra) lines.push(`  unpredicted red: ${t}`);
  for (const t of missing) lines.push(`  predicted red, stayed green: ${t}`);
  if (!r.red.length || r.total !== base.total) failed = true;
}
if (readFileSync(RULES, 'utf8') !== original) {
  lines.push('RULES NOT RESTORED');
  failed = true;
}
console.log(lines.join('\n'));
process.exit(failed ? 1 : 0);
