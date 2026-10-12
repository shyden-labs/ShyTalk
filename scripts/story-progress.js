#!/usr/bin/env node
'use strict';
/**
 * Progress from the story files, twice: by tickets and by effort (story
 * points in each story's `estimate:`), each with its measured pace and the
 * ETA that pace gives, over the whole backlog, then the MVP subset, which is
 * worked first (operator 2026-10-07). Every session close-out quotes these
 * lines, then adds what the pace cannot know: outside waits (store review,
 * operator sign-offs, devices) and any assumed change of pace.
 *
 * Usage: node scripts/story-progress.js [--today YYYY-MM-DD]
 *
 * The board mirrors the story files (scripts/sync-stories-to-issues.sh), so
 * the files are the source. A story became Done on the date of the newest
 * commit on the current branch whose diff adds or removes a `status: Done`
 * line in it: one `git log` for the whole corpus. Epic files and the index
 * are not stories; Cancelled stories are left out of every total.
 *
 * Spec: .project/stories/SHY-0535-every-story-carries-a-points-estimate-and-progress-reads-it.md
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STORIES_DIR = path.join('.project', 'stories');
const STORY_FILE = /^SHY-\d{4}-.+\.md$/;
const DAY_MS = 86_400_000;
const SHORT_WINDOW = 7;
const LONG_WINDOW = 30;

/** One story's frontmatter facts. Throws, naming the file, on anything it cannot read. */
function parseStory(text, file) {
  const fm = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(text);
  if (!fm) throw new Error(`${file}: no frontmatter`);
  const fields = {};
  for (const line of fm[1].split('\n')) {
    const kv = /^([A-Za-z_]+):(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  if (!fields.id) throw new Error(`${file}: no id`);
  if (!fields.status) throw new Error(`${file}: no status`);
  let estimate = null;
  if (fields.estimate !== undefined) {
    if (!/^[1-9]\d*$/.test(fields.estimate)) {
      throw new Error(`${file}: estimate "${fields.estimate}" is not a whole number of points`);
    }
    estimate = Number(fields.estimate);
  }
  return { file, id: fields.id, status: fields.status, estimate, mvp: fields.mvp === 'true' };
}

/**
 * Story file base name -> the date (YYYY-MM-DD) of the newest commit naming
 * it, from `git log --format=@%cs --name-only` (newest first). Non-story
 * paths are ignored; a path before any date line is refused.
 */
function doneDatesFromLog(log) {
  const dates = new Map();
  let date = null;
  for (const line of log.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('@')) {
      date = line.slice(1);
      continue;
    }
    if (date === null) throw new Error(`git log line before any date: ${line}`);
    const base = path.basename(line);
    if (STORY_FILE.test(base) && !dates.has(base)) dates.set(base, date);
  }
  return dates;
}

/** The UTC days of the `length`-day window ending `today`, oldest first. */
function windowDays(today, length) {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length }, (_, i) =>
    new Date(end - (length - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

function perDay(done, doneDates, days, weight) {
  return days.map((day) =>
    done.filter((s) => doneDates.get(s.file) === day).reduce((sum, s) => sum + weight(s), 0),
  );
}

function ticketsOf(scope, doneDates, today) {
  const done = scope.filter((s) => s.status === 'Done');
  return {
    closed: done.length,
    total: scope.length,
    pace7: perDay(done, doneDates, windowDays(today, SHORT_WINDOW), () => 1),
    pace30: perDay(done, doneDates, windowDays(today, LONG_WINDOW), () => 1),
  };
}

function effortOf(scope, doneDates, today) {
  const done = scope.filter((s) => s.status === 'Done');
  const open = scope.filter((s) => s.status !== 'Done');
  const scoredOpen = open.filter((s) => s.estimate !== null);
  if (scoredOpen.length < open.length) {
    return { available: false, scored: scoredOpen.length, open: open.length };
  }
  const scoredDone = done.filter((s) => s.estimate !== null);
  const scoredMean =
    scoredDone.length === 0
      ? 0
      : scoredDone.reduce((sum, s) => sum + s.estimate, 0) / scoredDone.length;
  const points = (s) => s.estimate ?? scoredMean;
  return {
    available: true,
    closedPoints: done.reduce((sum, s) => sum + points(s), 0),
    openPoints: open.reduce((sum, s) => sum + points(s), 0),
    assumedClosed: done.length - scoredDone.length,
    scoredMean,
    pace7: perDay(done, doneDates, windowDays(today, SHORT_WINDOW), points),
    pace30: perDay(done, doneDates, windowDays(today, LONG_WINDOW), points),
  };
}

function progress(stories, doneDates, today) {
  const scope = stories.filter((s) => s.status !== 'Cancelled');
  return {
    tickets: { ...ticketsOf(scope, doneDates, today), cancelled: stories.length - scope.length },
    effort: effortOf(scope, doneDates, today),
    mvp: ticketsOf(
      scope.filter((s) => s.mvp),
      doneDates,
      today,
    ),
  };
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const meanOf = (pace) => pace.reduce((a, b) => a + b, 0) / pace.length;
const percent = (part, whole) => Math.round((100 * part) / whole);

function dateAfter(today, days) {
  return new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The pace sentence and the ETA it gives: 7-day pace, else 30-day, else none. */
function paceAndEta(remaining, pace7, pace30, unit, today) {
  const shown = unit === 'points' ? pace7.map((n) => String(Math.round(n))) : pace7.map(String);
  const measured =
    `Measured pace ${meanOf(pace7).toFixed(2)} ${unit === 'points' ? 'points ' : ''}a day ` +
    `over the last ${plural(pace7.length, 'day')} (${shown.join(', ')}). `;
  if (meanOf(pace7) > 0) {
    const eta = dateAfter(today, Math.ceil(remaining / meanOf(pace7)));
    return `${measured}ETA at that pace: ${eta}, before outside waits.`;
  }
  if (meanOf(pace30) > 0) {
    const eta = dateAfter(today, Math.ceil(remaining / meanOf(pace30)));
    return (
      `${measured}Nothing closed in the last ${SHORT_WINDOW} days; ETA at the ${LONG_WINDOW}-day ` +
      `pace of ${meanOf(pace30).toFixed(2)} ${unit === 'points' ? 'points ' : ''}a day: ${eta}, before outside waits.`
    );
  }
  return `${measured}ETA unavailable at the measured pace: nothing closed in the last ${LONG_WINDOW} days.`;
}

function ticketsLine(label, t, cancelledNote, today) {
  return (
    `${label}: ${percent(t.closed, t.total)}% complete ` +
    `(${t.closed} of ${plural(t.total, 'story', 'stories')} Done${cancelledNote}). ` +
    paceAndEta(t.total - t.closed, t.pace7, t.pace30, 'stories', today)
  );
}

/** The close-out lines: by tickets, by effort, then the MVP subset. */
function formatLines(p, today) {
  if (p.tickets.total === 0) throw new Error('no stories in scope');
  const tickets = ticketsLine(
    'By tickets',
    p.tickets,
    `; ${p.tickets.cancelled} cancelled left out`,
    today,
  );
  const e = p.effort;
  let effort;
  if (!e.available) {
    effort = `By effort: unavailable, ${e.scored} of ${e.open} open tickets scored`;
  } else {
    const total = e.closedPoints + e.openPoints;
    const assumed =
      e.assumedClosed === 0
        ? ''
        : `; ${plural(e.assumedClosed, 'Done story', 'Done stories')} unscored, ` +
          `counted at the scored mean of ${e.scoredMean.toFixed(1)} points (assumed)`;
    effort =
      `By effort: ${percent(e.closedPoints, total)}% complete ` +
      `(${Math.round(e.closedPoints)} of ${Math.round(total)} points Done${assumed}). ` +
      paceAndEta(e.openPoints, e.pace7, e.pace30, 'points', today);
  }
  const mvp =
    p.mvp.total === 0
      ? 'MVP subset (worked first): no mvp: true stories in scope.'
      : ticketsLine('MVP subset (worked first)', p.mvp, '', today);
  return [tickets, effort, mvp];
}

function main(argv) {
  const at = argv.indexOf('--today');
  const today = at === -1 ? new Date().toISOString().slice(0, 10) : argv[at + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) throw new Error('--today needs YYYY-MM-DD');
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
  const dir = path.join(root, STORIES_DIR);
  const stories = fs
    .readdirSync(dir)
    .filter((f) => STORY_FILE.test(f))
    .sort()
    .map((f) => parseStory(fs.readFileSync(path.join(dir, f), 'utf-8'), f));
  const log = execFileSync(
    'git',
    ['log', '--format=@%cs', '--name-only', '-G', '^status:[[:space:]]*Done', '--', STORIES_DIR],
    { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  );
  for (const line of formatLines(progress(stories, doneDatesFromLog(log), today), today)) {
    process.stdout.write(`${line}\n`);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`story-progress: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { parseStory, doneDatesFromLog, progress, formatLines };
