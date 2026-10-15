#!/usr/bin/env node
'use strict';

/**
 * tester-notes.js — SHY-0361: the note a tester reads with a dev build.
 *
 * Operator, 2026-08-20: "in the app tester app build notes, it should have the
 * information about the last ticket, even if it's a deploy from develop (but
 * still says it's a deploy from develop)."
 *
 * Input is the change list deploy-dev.yml's `list-build-changes` job writes:
 *
 *   #baseline <sha>                       (or `#unresolved`)
 *   <sha>\t<areas>\t<subject>             one line per first-parent commit,
 *                                         newest first; <areas> is the comma
 *                                         list scripts/deploy-scope.sh set
 *                                         true for that commit, `-`, or `docs`
 *                                         for a commit touching only story
 *                                         paperwork under .project/
 *
 * Shyden, 2026-10-14, after the first real build named no ticket: "it needs
 * to name ALL tickets since the last build. not just the ticket name but it
 * must include the summary name and what to test". So every ticket a commit
 * since the last build names is listed in both apps' notes, whatever it
 * touched, each with its story title, what changed (the merge's summary) and
 * what to test (the story's BDD scenario titles). A ticket whose story is still
 * Draft was only filed, so it is named with nothing to test. A ticket named
 * only by paperwork commits (its story marked Done, say) is named as updated
 * with nothing new to test, and "what changed" always comes from the newest
 * commit that changed code. The first line names the newest ticket with
 * something to test. Changes with no
 * ticket are filtered by deploy-scope.sh's areas: one reaches the Android note
 * when it touches the backend or Android, and the iOS note likewise.
 *
 * A gap we can explain (no baseline, a ticket with no story file) gives a note
 * that says so plainly. A fault (malformed input, an unknown platform) throws:
 * Shyden ruled 2026-10-14 that a real notes fault fails the deploy job red.
 *
 * CLI (deploy-dev.yml): node scripts/tester-notes.js <android|ios>
 *   env CHANGES, DEPLOY_REF, DEPLOY_SHA, DEPLOY_TRIGGER, RELEASE_NOTES_INPUT
 *   prints the note on stdout.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Neither Firebase App Distribution nor TestFlight documents a limit for
 * tester notes (searched 2026-10-14); 4000 is App Store's documented limit for
 * its own "What's New" text, used here as an assumed cap for both.
 */
const NOTES_LIMIT = 4000;

/** One entry line, so a single long title cannot crowd the others out. */
const LINE_LIMIT = 200;

/** Every area scripts/deploy-scope.sh writes, and list-build-changes' paperwork marker. */
const AREAS = new Set(['backend', 'web', 'android', 'ios', 'docs']);

/** Which commits each app's note lists: its own area, plus the API it calls. */
const PLATFORM_AREAS = {
  android: ['android', 'backend'],
  ios: ['ios', 'backend'],
};

const TRIGGERS = {
  workflow_dispatch: 'started by hand',
  push: 'started automatically by a merge',
  schedule: 'the daily catch-up',
};

const ID = /SHY-\d{4}(?!\d)/g;

/** Parse the change list; throws on anything the list job would never write. */
function parseChanges(text) {
  const lines = String(text)
    .split('\n')
    .filter((l) => l !== '');
  const header = lines[0] ?? '';
  if (header === '#unresolved' && lines.length === 1) return { resolved: false, changes: [] };
  if (!/^#baseline \S+$/.test(header)) {
    throw new Error(`change list must open with a header line, got: ${JSON.stringify(header)}`);
  }
  const changes = lines.slice(1).map((l) => {
    const first = l.indexOf('\t');
    const second = first === -1 ? -1 : l.indexOf('\t', first + 1);
    if (second === -1) throw new Error(`malformed change line: ${JSON.stringify(l)}`);
    const areasField = l.slice(first + 1, second);
    const areas = areasField === '-' ? [] : areasField.split(',');
    for (const a of areas) {
      if (!AREAS.has(a))
        throw new Error(`unknown area "${a}" in change line: ${JSON.stringify(l)}`);
    }
    return { sha: l.slice(0, first), areas, subject: l.slice(second + 1) };
  });
  return { resolved: true, changes };
}

/** Every ticket id a subject names, in the order written, each once. */
function ticketIds(subject) {
  return [...new Set(subject.match(ID) ?? [])];
}

const PATH_LIKE =
  /\S\/\S|\b[\w-]+\.(?:js|mjs|cjs|ts|tsx|kt|kts|swift|ya?ml|json|sh|md|py|xml|gradle|plist|toml)\b/;

/**
 * The commit subject as a one-line summary of what changed, or null when it
 * would show a tester a link, a pull request or a file path (SHY-0361 security
 * AC), or when nothing is left once the ids are gone.
 */
function summarise(subject) {
  let s = subject.trim();
  s = s.replace(/\s*\(#\d+\)$/, '');
  s = s.replace(/\s*\(SHY-\d{4}[^)]*\)$/, '');
  s = s.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, '');
  s = s.replace(/^SHY-\d{4}(?:\.\.\d{4})?(?:\s*(?:\+|,|and)\s*SHY-\d{4})*(?:\s*\(P\d\))?:?\s*/, '');
  s = s.trim();
  if (s === '' || /#\d/.test(s) || /:\/\//.test(s) || PATH_LIKE.test(s)) return null;
  return s;
}

/**
 * What a tester needs from a story: its title (the `# SHY-XXXX: Title`
 * heading), its frontmatter status, and the title of every BDD scenario, which
 * is what to test.
 */
function storyInfo(text, id) {
  const heading = new RegExp(`^# ${id}: (.+)$`, 'm').exec(text);
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  const status = front ? /^status: (.+)$/m.exec(front[1]) : null;
  const scenarios = [...text.matchAll(/^\*\*Scenario: (.+?)\*\*\s*$/gm)].map((m) => m[1].trim());
  return {
    title: heading ? heading[1].trim() : null,
    status: status ? status[1].trim() : null,
    scenarios,
  };
}

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** One ticket's lines: id and title, what changed, what to test. */
function entryBlock(id, story, { summary, code }) {
  const title = story?.title ?? null;
  const lines = [`- ${id}${title ? ` ${title}` : ''}`];
  if (story?.status === 'Draft') {
    lines.push('  Filed, not built yet: nothing to test.');
  } else if (!code) {
    lines.push('  Story updated only in this build: nothing new to test.');
  } else {
    if (summary && summary.toLowerCase() !== (title ?? '').toLowerCase()) {
      lines.push(`  What changed: ${summary}`);
    }
    if (!story) lines.push('  What to test: not written down (no story file)');
    else if (story.scenarios.length === 0) lines.push('  What to test: not written in the story');
    else lines.push(`  What to test: ${story.scenarios.join('; ')}`);
  }
  return lines.map((l) => clip(l, LINE_LIMIT)).join('\n');
}

/** The lines that fit `budget` characters; the rest are counted, never silently dropped. */
function fitting(lines, budget) {
  const kept = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const after = lines.length - i - 1;
    const tail = after > 0 ? `- …and ${after} more\n`.length : 0;
    if (used + lines[i].length + 1 + tail > budget) {
      kept.push(`- …and ${lines.length - i} more`);
      return kept;
    }
    kept.push(lines[i]);
    used += lines[i].length + 1;
  }
  return kept;
}

/** The whole note for one app's build. */
function buildNotes({ platform, resolved, changes, stories, ref, sha, trigger, override }) {
  if (override && override.trim() !== '') return override.slice(0, NOTES_LIMIT);
  const areas = PLATFORM_AREAS[platform];
  if (!areas) throw new Error(`unknown platform "${platform}" (expected android or ios)`);
  if (!sha) throw new Error('a deploy sha is required');

  const how = TRIGGERS[trigger] ?? `started by ${trigger}`;
  const provenance = `Deploy from ${ref} at ${sha.slice(0, 11)}, ${how}.`;

  if (!resolved) {
    return [
      'What to test: unknown, because the last dev build could not be found to compare against',
      '',
      provenance,
    ].join('\n');
  }

  // id -> { summary of its newest code commit, whether any code commit named it },
  // newest ticket first. A paperwork commit lists a ticket but never supplies its summary.
  const tickets = new Map();
  const others = [];
  for (const c of changes) {
    const ids = ticketIds(c.subject);
    if (ids.length === 0) {
      if (!c.areas.some((a) => areas.includes(a))) continue;
      const s = summarise(c.subject);
      others.push(s ? clip(`- ${s}`, LINE_LIMIT) : '- a change with no ticket');
      continue;
    }
    const code = !c.areas.includes('docs');
    for (const id of ids) {
      const seen = tickets.get(id);
      if (!seen) tickets.set(id, { summary: code ? summarise(c.subject) : null, code });
      else if (code && !seen.code) tickets.set(id, { summary: summarise(c.subject), code });
    }
  }

  const testable = [...tickets].find(([id, t]) => t.code && stories.get(id)?.status !== 'Draft');

  let first;
  if (testable) {
    const [id, { summary: s }] = testable;
    const name = stories.get(id)?.title ?? s;
    const more = tickets.size > 1 ? ` (+${tickets.size - 1} more below)` : '';
    first = clip(`What to test: ${id}${name ? ` ${name}` : ''}`, LINE_LIMIT) + more;
  } else if (others.length > 0) {
    const plural = others.length === 1 ? '' : 's';
    first = `What to test: no ticket in this build; ${others.length} other change${plural} below`;
  } else {
    first = 'What to test: nothing new for this app since the last dev build';
  }

  const sections = [];
  let budget = NOTES_LIMIT - first.length - provenance.length - 4;
  if (tickets.size > 0) {
    const heading = 'Tickets since the last build, newest first:';
    const lines = [...tickets].map(([id, t]) => entryBlock(id, stories.get(id), t));
    const section = [heading, ...fitting(lines, budget - heading.length - 3)].join('\n');
    sections.push(section);
    budget -= section.length + 2;
  }
  if (others.length > 0) {
    const heading = 'Other changes:';
    const room = budget - heading.length - 3;
    const lines = room > 30 ? fitting(others, room) : [`- …and ${others.length} more`];
    sections.push([heading, ...lines].join('\n'));
  }

  return [first, '', ...sections.flatMap((s) => [s, '']), provenance].join('\n');
}

/** What each named ticket's story file says, read from .project/stories/. */
function readStories(ids, storiesDir) {
  const files = fs.readdirSync(storiesDir);
  const stories = new Map();
  for (const id of new Set(ids)) {
    const file = files.find((f) => f.startsWith(`${id}-`) && f.endsWith('.md'));
    if (!file) continue;
    stories.set(id, storyInfo(fs.readFileSync(path.join(storiesDir, file), 'utf8'), id));
  }
  return stories;
}

function main() {
  const env = process.env;
  const parsed = parseChanges(env.CHANGES ?? '');
  const ids = parsed.changes.flatMap((c) => ticketIds(c.subject));
  const stories = readStories(ids, path.join(__dirname, '..', '.project', 'stories'));
  process.stdout.write(
    buildNotes({
      platform: process.argv[2],
      ...parsed,
      stories,
      ref: env.DEPLOY_REF,
      sha: env.DEPLOY_SHA,
      trigger: env.DEPLOY_TRIGGER,
      override: env.RELEASE_NOTES_INPUT ?? '',
    }),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`::error::tester-notes: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  NOTES_LIMIT,
  LINE_LIMIT,
  parseChanges,
  ticketIds,
  summarise,
  storyInfo,
  buildNotes,
  readStories,
};
