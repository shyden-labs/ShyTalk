#!/usr/bin/env node
'use strict';

/**
 * deploy-plan.js — SHY-0534: what one Deploy To Dev run deploys.
 *
 * Shyden, 2026-10-14: a merge into `develop` deploys to dev on its own, and only
 * what it changed ("be sensible and only deploy what's got changes to it").
 *
 *   an area deploys  =  requested  AND  changed
 *
 * - changed: scripts/deploy-scope.sh's verdict on the diff since the last
 *   successful dev deploy (SHY-0347), passed in as its raw output.
 * - requested: the dispatch form's checkbox on a hand-started run; everything
 *   on a push or the daily catch-up, where nobody is there to tick boxes.
 *
 * The daily catch-up (Shyden, 2026-09-19) deploys nothing when dev already
 * holds develop's head.
 *
 * This is the one place the decision is made: every deploy job in
 * deploy-dev.yml reads only these outputs, never a dispatch input.
 *
 * CLI (the scope job): env EVENT, BASELINE, HEAD_SHA, SCOPE, INPUT_* ;
 * prints GITHUB_OUTPUT lines.
 */

const AREAS = ['backend', 'web', 'android', 'ios'];

/** The dispatch checkbox behind each decision. */
const BOXES = {
  backend: 'backend',
  web: 'web',
  android: 'android-testers',
  ios: 'ios-testers',
  seed: 'seed-personas',
  checks: 'playwright',
};

const EVENTS = new Set(['push', 'schedule', 'workflow_dispatch']);

/** deploy-scope.sh's output as { changed, reason }; throws on anything it never writes. */
function parseScope(text) {
  const values = {};
  for (const line of String(text).split('\n')) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  const changed = {};
  for (const area of AREAS) {
    if (values[area] !== 'true' && values[area] !== 'false') {
      throw new Error(`deploy-scope.sh output has no true/false for ${area}`);
    }
    changed[area] = values[area] === 'true';
  }
  if (!values.reason) throw new Error('deploy-scope.sh output has no reason');
  return { changed, reason: values.reason };
}

function requested(event, inputs, decision) {
  if (event !== 'workflow_dispatch') return true;
  const box = BOXES[decision];
  const value = inputs[box];
  if (value !== 'true' && value !== 'false') {
    throw new Error(`dispatch input ${box} must be true or false, got ${JSON.stringify(value)}`);
  }
  return value === 'true';
}

/** The run's decisions. */
function plan({ event, baseline, head, scope, inputs = {} }) {
  if (!EVENTS.has(event)) {
    throw new Error(`Deploy To Dev runs on push, schedule or workflow_dispatch, not ${event}`);
  }
  const { changed, reason } = parseScope(scope);
  if (event === 'schedule' && baseline && baseline !== 'unresolved' && baseline === head) {
    return {
      backend: false,
      web: false,
      android: false,
      ios: false,
      seed: false,
      checks: false,
      changed,
      reason: 'dev-current',
    };
  }
  const out = { changed, reason };
  for (const area of AREAS) out[area] = requested(event, inputs, area) && changed[area];
  out.seed = requested(event, inputs, 'seed');
  out.checks = requested(event, inputs, 'checks');
  return out;
}

/** GITHUB_OUTPUT lines for the jobs and the run summary. */
function asOutputs(p, trigger) {
  const lines = [
    ...AREAS.map((a) => `${a}=${p[a]}`),
    `seed=${p.seed}`,
    `checks=${p.checks}`,
    ...AREAS.map((a) => `changed_${a}=${p.changed[a]}`),
    `reason=${p.reason}`,
    `trigger=${trigger}`,
  ];
  return `${lines.join('\n')}\n`;
}

function main(env = process.env) {
  const inputs = {
    backend: env.INPUT_BACKEND,
    web: env.INPUT_WEB,
    'android-testers': env.INPUT_ANDROID_TESTERS,
    'ios-testers': env.INPUT_IOS_TESTERS,
    'seed-personas': env.INPUT_SEED_PERSONAS,
    playwright: env.INPUT_PLAYWRIGHT,
  };
  const p = plan({
    event: env.EVENT,
    baseline: env.BASELINE,
    head: env.HEAD_SHA,
    scope: env.SCOPE ?? '',
    inputs,
  });
  process.stdout.write(asOutputs(p, env.EVENT));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`::error::deploy-plan: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { plan, parseScope, asOutputs };
