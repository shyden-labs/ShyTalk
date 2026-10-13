#!/usr/bin/env node
/**
 * check-orphaned-stories.js — SHY-0583.
 *
 * Fails while any story is `In Progress` and nothing is working it: no open
 * pull request (by title or head branch) names its id, and no remote branch names
 * it that has no closed pull request (a branch counts until its PR closes).
 * Shyden, 2026-10-13: an In Progress story with no branch or PR is an error and
 * "should be returned to the backlog ... these must be fixed right away". It
 * runs in the required Pre-Merge Gate on every pull request, against that PR's
 * tree, so an orphan blocks merges until a PR returns it to Draft (which the
 * story-status gate allows, SHY-0583) or a branch for it is pushed.
 *
 * Reads the story files from the working tree; asks `gh pr list` for open pull
 * requests and `git ls-remote --heads origin` for branches. Fails closed when
 * either cannot answer, or when the PR list may be truncated.
 *
 * Exit: 0 = no orphans; 1 = orphans (named); 2 = could not look.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STORY_DIR = '.project/stories';
const STORY_FILE = /^SHY-\d{4}-.+\.md$/;
const PR_LIMIT = 500;

/** The In Progress stories among `files` ([{ file, text }]), as [{ id, file }]. */
function inProgressStories(files) {
  const out = [];
  for (const { file, text } of files) {
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const status = fm && fm[1].match(/^status:[ \t]*(.+?)[ \t]*$/m);
    if (!status) throw new Error(`${file} has no status: field`);
    if (status[1] !== 'In Progress') continue;
    const id = fm[1].match(/^id:[ \t]*(SHY-\d{4})[ \t]*$/m);
    if (!id) throw new Error(`${file} has no id: field`);
    out.push({ id: id[1], file });
  }
  return out;
}

/** Does `text` name the story `id` (SHY-0113, shy-0113 or shy0113, not SHY-01130)? */
function names(text, id) {
  const digits = id.slice(4);
  return new RegExp(`(^|[^0-9a-z])shy-?${digits}(?![0-9])`, 'i').test(text);
}

/** The stories that no open PR (title or head branch) and no remote branch names. */
/**
 * The stories nothing claims. An open PR naming the id always claims it; a remote
 * branch naming it claims it only while that branch has no closed PR, merged or
 * not (`closedHeads`; Shyden 2026-10-13: "Branch counts until its PR closes"), so
 * a leftover branch cannot hide an abandoned story.
 */
function findOrphans(stories, openPrs, branches, closedHeads) {
  return stories.filter(
    ({ id }) =>
      !openPrs.some((pr) => names(pr.title, id) || names(pr.headRefName, id)) &&
      !branches.some((b) => names(b, id) && !closedHeads.includes(b)),
  );
}

/** Branch names from `git ls-remote --heads` output. A remote always has develop, so none is a failure. */
function parseHeads(output) {
  const heads = output
    .split('\n')
    .map((line) => line.split('\t')[1])
    .filter((ref) => ref && ref.startsWith('refs/heads/'))
    .map((ref) => ref.slice('refs/heads/'.length));
  if (heads.length === 0)
    throw new Error('git ls-remote listed no branches; refusing to judge orphans blind');
  return heads;
}

function main() {
  let stories, openPrs, branches, closedHeads;
  try {
    const files = fs
      .readdirSync(STORY_DIR)
      .filter((f) => STORY_FILE.test(f))
      .map((f) => ({
        file: `${STORY_DIR}/${f}`,
        text: fs.readFileSync(path.join(STORY_DIR, f), 'utf8'),
      }));
    if (files.length === 0) throw new Error(`no story files under ${STORY_DIR}`);
    stories = inProgressStories(files);
    process.stdout.write(
      `orphan-check: ${files.length} story files read, ${stories.length} In Progress\n`,
    );
    if (stories.length === 0) return 0;
    openPrs = JSON.parse(
      execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          String(PR_LIMIT),
          '--json',
          'title,headRefName',
        ],
        {
          encoding: 'utf8',
        },
      ),
    );
    if (!Array.isArray(openPrs)) throw new Error('gh pr list did not print a list');
    if (openPrs.length >= PR_LIMIT)
      throw new Error(`gh pr list hit its limit of ${PR_LIMIT}; the list may be cut short`);
    branches = parseHeads(
      execFileSync('git', ['ls-remote', '--heads', 'origin'], { encoding: 'utf8' }),
    );
    // A branch counts only while it has no closed PR: ask for each branch that names a story.
    const candidates = branches.filter((b) => stories.some(({ id }) => names(b, id)));
    closedHeads = candidates.filter((b) => {
      const closed = JSON.parse(
        execFileSync(
          'gh',
          ['pr', 'list', '--state', 'closed', '--head', b, '--limit', '1', '--json', 'number'],
          {
            encoding: 'utf8',
          },
        ),
      );
      if (!Array.isArray(closed)) throw new Error(`gh pr list --head ${b} did not print a list`);
      return closed.length > 0;
    });
    process.stdout.write(
      `orphan-check: ${closedHeads.length} of ${candidates.length} candidate branches have a closed PR\n`,
    );
  } catch (err) {
    process.stderr.write(`::error::orphan-check: could not look: ${err.message}\n`);
    return 2;
  }
  const orphans = findOrphans(stories, openPrs, branches, closedHeads);
  process.stdout.write(
    `orphan-check: ${openPrs.length} open PRs and ${branches.length} branches searched\n`,
  );
  if (orphans.length === 0) {
    process.stdout.write('orphan-check: every In Progress story has a branch or an open PR\n');
    return 0;
  }
  for (const o of orphans) {
    process.stderr.write(
      `::error::orphan-check: ${o.id} (${o.file}) is In Progress, but no open pull request and no branch names it. ` +
        'Return it to the backlog (status: Draft, in a PR that changes only .project/) or push its branch.\n',
    );
  }
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { inProgressStories, findOrphans, parseHeads };
