#!/usr/bin/env node
'use strict';

/**
 * deploy-failure-issue.js — SHY-0534: a failed automatic dev deploy reaches
 * someone without anyone watching Actions.
 *
 * A push to develop, or the daily catch-up, runs Deploy To Dev with nobody
 * watching. One tracking issue, assigned to Shyden, is opened on the first
 * failure, commented on while it stays open, and closed by the next automatic
 * run that succeeds. Global rule: nothing we rely on stops silently.
 *
 * CLI (deploy-dev.yml's report-automatic-deploy job): env NEEDS (toJSON(needs)),
 * GH_TOKEN, RUN_URL, RUN_SHA, TRIGGER.
 */

const TITLE = 'Automatic dev deploy is failing';
const ASSIGNEE = 'ShydenMcM';
const RESULTS = new Set(['success', 'skipped', 'failure', 'cancelled']);

/** "job (result)" for each job that failed or was cancelled; throws on anything else unknown. */
function failedJobs(results) {
  const entries = Object.entries(results);
  if (entries.length === 0) throw new Error('no job results to judge');
  for (const [job, result] of entries) {
    if (!RESULTS.has(result))
      throw new Error(`job ${job} has an unknown result ${JSON.stringify(result)}`);
  }
  return entries
    .filter(([, result]) => result === 'failure' || result === 'cancelled')
    .map(([job, result]) => `${job} (${result})`);
}

/** What to do with the tracking issue: open, comment, close or none. */
function decide({ results, open, run }) {
  const failed = failedJobs(results);
  const mine = open.filter((i) => i.title === TITLE);
  if (mine.length > 1) {
    throw new Error(`${mine.length} open issues titled "${TITLE}"; expected at most one`);
  }
  const issue = mine[0];
  const where = `Run: ${run.url}\nCommit: ${run.sha}\nTrigger: ${run.trigger}`;
  if (failed.length > 0) {
    const body = `${where}\n\nFailed jobs:\n${failed.map((f) => `- ${f}`).join('\n')}\n\nThe next automatic run deploys the same changes again, from the last successful dev deploy.`;
    if (issue) return { kind: 'comment', number: issue.number, body };
    return { kind: 'open', title: TITLE, assignee: ASSIGNEE, body };
  }
  if (issue) {
    return {
      kind: 'close',
      number: issue.number,
      body: `Fixed: an automatic dev deploy succeeded.\n\n${where}`,
    };
  }
  return { kind: 'none' };
}

function main(env = process.env) {
  const { execFileSync } = require('node:child_process');
  const { existsSync } = require('node:fs');
  const candidates = ['/usr/bin/gh', '/opt/homebrew/bin/gh'];
  const GH = candidates.find((p) => existsSync(p));
  if (!GH) throw new Error(`gh not found at ${candidates.join(' or ')}`);
  const gh = (args) => execFileSync(GH, args, { encoding: 'utf8' });

  const needs = JSON.parse(env.NEEDS);
  const results = Object.fromEntries(Object.entries(needs).map(([job, n]) => [job, n.result]));
  const open = JSON.parse(
    gh([
      'issue',
      'list',
      '--state',
      'open',
      '--search',
      `"${TITLE}" in:title`,
      '--json',
      'number,title',
      '--limit',
      '100',
    ]),
  );
  const action = decide({
    results,
    open,
    run: { url: env.RUN_URL, sha: env.RUN_SHA, trigger: env.TRIGGER },
  });
  if (action.kind === 'open') {
    gh([
      'issue',
      'create',
      '--title',
      action.title,
      '--assignee',
      action.assignee,
      '--body',
      action.body,
    ]);
  } else if (action.kind === 'comment') {
    gh(['issue', 'comment', String(action.number), '--body', action.body]);
  } else if (action.kind === 'close') {
    gh(['issue', 'close', String(action.number), '--comment', action.body]);
  }
  console.log(`deploy-failure-issue: ${action.kind}${action.number ? ` #${action.number}` : ''}`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`::error::deploy-failure-issue: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { TITLE, ASSIGNEE, failedJobs, decide };
