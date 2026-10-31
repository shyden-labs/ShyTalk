/**
 * Fails, naming each, while an open issue on the board is In Progress and
 * nothing is working it: no open pull request names it (`#<n>` in its title or
 * body, a closing reference, or a head branch starting `<n>-`) and no remote
 * branch starts `<n>-` without a closed pull request (issue shyden-labs/repo-template#10; operator 2026-10-13: "if a ticket is not in
 * progress then it should not be marked as in progress"). Run it in the
 * repository's required PR checks with a token that can read the board:
 *
 *   node scripts/board-orphans.ts <board-node-id> "<board title>" <owner/repo>
 *
 * It fails closed when it cannot read the board, the pull requests or the
 * branches, or when a list may be cut short. Return an orphan to the backlog by
 * setting its Status back, or push its branch.
 */
import { execFileSync } from 'node:child_process';
import { assertWholeRead, emptyBoardNote } from './board-progress.ts';
import { runIfEntry } from './cli.ts';

export interface OpenPullRequest {
  title: string;
  body: string;
  headRefName: string;
  closes: number[];
}

interface RawItem {
  status: { name?: string } | null;
  content: { __typename?: string; number?: number; state?: string } | null;
}

interface RawPage {
  data: { node: { title: string; items: { nodes: RawItem[] } } };
}

/** The open issues whose board Status is In Progress, in board order. */
export function inProgressIssues(pages: unknown[]): number[] {
  return (pages as RawPage[]).flatMap((page) =>
    page.data.node.items.nodes
      .filter(
        (n) =>
          n.content?.__typename === 'Issue' &&
          n.content.state === 'OPEN' &&
          n.status?.name === 'In Progress' &&
          typeof n.content.number === 'number',
      )
      .map((n) => n.content?.number as number),
  );
}

function mentions(text: string, n: number): boolean {
  return new RegExp(`#${n}(?![0-9])`).test(text);
}

function startsWithIssue(branch: string, n: number): boolean {
  return branch.startsWith(`${n}-`);
}

/**
 * The In Progress issues that nothing claims. An open pull request naming the
 * issue always claims it; a remote branch claims it only while that branch has no
 * closed pull request, merged or not (operator 2026-10-13: "Branch counts until its
 * PR closes"), so a leftover branch cannot hide an abandoned ticket.
 */
export function findOrphanIssues(issues: number[], prs: OpenPullRequest[], branches: string[], closedHeads: string[]): number[] {
  return issues.filter(
    (n) =>
      !prs.some((p) => mentions(p.title, n) || mentions(p.body, n) || p.closes.includes(n) || startsWithIssue(p.headRefName, n)) &&
      !branches.some((b) => startsWithIssue(b, n) && !closedHeads.includes(b)),
  );
}

export const QUERY = `query($id: ID!, $endCursor: String) {
  node(id: $id) { ... on ProjectV2 { title
    items(first: 100, after: $endCursor) { totalCount pageInfo { hasNextPage endCursor }
      nodes {
        status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
        content { __typename ... on Issue { number state } } } } } } }`;

const PR_LIMIT = 500;

function gh(args: string[]): unknown {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64e6 }));
}

export function main(args: string[]): number {
  const [id, title, repo] = args;
  if (id === undefined || title === undefined || repo === undefined || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('usage: node scripts/board-orphans.ts <board-node-id> "<board title>" <owner/repo>');
  }
  const pages = gh(['api', 'graphql', '--paginate', '--slurp', '-f', `query=${QUERY}`, '-f', `id=${id}`]) as RawPage[];
  if (assertWholeRead(pages, title) === 0) {
    process.stdout.write(`board-orphans: ${emptyBoardNote(title)}; nothing is In Progress\n`);
    return 0;
  }
  const issues = inProgressIssues(pages);
  process.stdout.write(`board-orphans: ${issues.length} open issue(s) In Progress on "${title}"\n`);
  if (issues.length === 0) return 0;
  const raw = gh([
    'pr',
    'list',
    '-R',
    repo,
    '--state',
    'open',
    '--limit',
    String(PR_LIMIT),
    '--json',
    'title,body,headRefName,closingIssuesReferences',
  ]) as { title: string; body: string; headRefName: string; closingIssuesReferences: { number: number }[] }[];
  if (raw.length >= PR_LIMIT) throw new Error(`gh pr list hit its limit of ${PR_LIMIT}; the list may be cut short`);
  const prs = raw.map((p) => ({ ...p, closes: p.closingIssuesReferences.map((c) => c.number) }));
  const branches = (gh(['api', '--paginate', '--slurp', `repos/${repo}/branches?per_page=100`]) as { name: string }[][])
    .flat()
    .map((b) => b.name);
  if (branches.length === 0) throw new Error('the repository listed no branches; refusing to judge orphans blind');
  // A branch counts only while it has no closed pull request: ask for each branch that names an issue.
  const candidates = branches.filter((b) => issues.some((n) => startsWithIssue(b, n)));
  const closedHeads = candidates.filter(
    (b) => (gh(['pr', 'list', '-R', repo, '--state', 'closed', '--head', b, '--limit', '1', '--json', 'number']) as unknown[]).length > 0,
  );
  process.stdout.write(
    `board-orphans: ${prs.length} open pull request(s), ${branches.length} branch(es) searched; ` +
      `${closedHeads.length} of ${candidates.length} candidate branch(es) have a closed pull request\n`,
  );
  const orphans = findOrphanIssues(issues, prs, branches, closedHeads);
  for (const n of orphans) {
    process.stderr.write(
      `board-orphans: #${n} is In Progress, but no open pull request and no branch is working it. ` +
        'Set its Status back to the backlog, or push its branch (named <issue>-<slug>).\n',
    );
  }
  return orphans.length === 0 ? 0 : 1;
}

await runIfEntry(import.meta.url, main);
