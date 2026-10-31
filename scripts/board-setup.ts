/**
 * Gives a project board the Number field `Estimate` that progress by effort
 * reads, and the single-select field `Priority` (P0 to P5) that
 * `board-next.ts` names the next ticket from (docs/project-board.md). Run
 * once per board:
 *
 *   node scripts/board-setup.ts <board-node-id> "<board title>"
 *
 * It reads the board by node id, refuses a board whose title differs, creates
 * each field only if it is missing, and reads both back.
 */
import { execFileSync } from 'node:child_process';
import { assertTitle } from './board-progress.ts';
import { runIfEntry } from './cli.ts';

interface Field {
  name: string;
  dataType: string;
  options?: Array<{ name: string }>;
}

/** What the board needs: the field created, or nothing. */
export function planEstimateField(fields: Field[]): 'create' | 'exists' {
  const found = fields.find((f) => f.name === 'Estimate');
  if (found === undefined) return 'create';
  if (found.dataType !== 'NUMBER') {
    throw new Error(`the board has an "Estimate" field of type ${found.dataType}; it must be NUMBER: rename or delete it first`);
  }
  return 'exists';
}

/**
 * The six priorities, in order, each with what it means (operator
 * 2026-10-12). The board's option descriptions carry these words, so a
 * ticket is scored against the same definition everywhere it is read.
 */
export const PRIORITY_OPTIONS = [
  {
    name: 'P0',
    color: 'RED',
    description: 'Now: a live defect, a vulnerability, broken CI or deploy, or a release blocker.',
  },
  {
    name: 'P1',
    color: 'ORANGE',
    description:
      'Next: something the operator asked for directly, or work already in flight. A blocker is not P1 by being one: it is raised to the level of what waits on it.',
  },
  {
    name: 'P2',
    color: 'YELLOW',
    description:
      'Important: user-facing improvements and the standing quality rules (test limits, guards that cannot see what they judge).',
  },
  { name: 'P3', color: 'GREEN', description: 'Planned: ordinary backlog.' },
  { name: 'P4', color: 'BLUE', description: 'Later: worth doing, no pressure.' },
  { name: 'P5', color: 'GRAY', description: 'Someday: ideas and nice-to-haves.' },
] as const;

/** What the board needs for `Priority`: the field created, or nothing. */
export function planPriorityField(fields: Field[]): 'create' | 'exists' {
  const found = fields.find((f) => f.name === 'Priority');
  if (found === undefined) return 'create';
  if (found.dataType !== 'SINGLE_SELECT') {
    throw new Error(`the board has a "Priority" field of type ${found.dataType}; it must be SINGLE_SELECT: rename or delete it first`);
  }
  const have = (found.options ?? []).map((o) => o.name);
  const want = PRIORITY_OPTIONS.map((o) => o.name);
  if (have.join('|') !== want.join('|')) {
    throw new Error(
      `the board's "Priority" options are ${have.join(', ')}; they must be ${want.join(', ')} in that order: edit the field first`,
    );
  }
  return 'exists';
}

function gql(query: string, vars: Record<string, string>): unknown {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push('-f', `${k}=${v}`);
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
}

interface Board {
  data: { node: { title: string; fields: { nodes: Field[] } } };
}

const READ = `query($id: ID!) { node(id: $id) { ... on ProjectV2 { title
  fields(first: 50) { nodes { ... on ProjectV2FieldCommon { name dataType }
    ... on ProjectV2SingleSelectField { options { name } } } } } } }`;

const CREATE_PRIORITY = `mutation($id: ID!) { createProjectV2Field(input: {
  projectId: $id, dataType: SINGLE_SELECT, name: "Priority",
  singleSelectOptions: [${PRIORITY_OPTIONS.map((o) => `{ name: "${o.name}", color: ${o.color}, description: "${o.description}" }`).join(
    ', ',
  )}] }) { clientMutationId } }`;

export function main(args: string[]): number {
  const [id, title] = args;
  if (id === undefined || title === undefined) {
    throw new Error('usage: node scripts/board-setup.ts <board-node-id> "<board title>"');
  }
  const read = (): Board => gql(READ, { id }) as Board;
  const before = read().data.node;
  assertTitle(before.title, title);
  if (planEstimateField(before.fields.nodes) === 'create') {
    gql(`mutation($id: ID!) { createProjectV2Field(input: { projectId: $id, dataType: NUMBER, name: "Estimate" }) { clientMutationId } }`, {
      id,
    });
  }
  if (planPriorityField(before.fields.nodes) === 'create') {
    gql(CREATE_PRIORITY, { id });
  }
  const after = read().data.node;
  if (planEstimateField(after.fields.nodes) !== 'exists') {
    throw new Error('the Estimate field was not there on reading back');
  }
  if (planPriorityField(after.fields.nodes) !== 'exists') {
    throw new Error('the Priority field was not there on reading back');
  }
  process.stdout.write(`"${after.title}" has a Number field "Estimate" and a single-select field "Priority" (P0-P5).\n`);
  return 0;
}

await runIfEntry(import.meta.url, main);
