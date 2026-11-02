/**
 * The daily door count (decision 197; plan 2 Task E6 Step 5,
 * shyden-labs/ShyTalk#31). Only people use the doors, so each door's requests
 * over the past day are read from Cloudflare's GraphQL analytics and judged
 * against its limit:
 *
 *   CLOUDFLARE_ANALYTICS_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/door-count.ts
 *
 * Exits 1 when a door is over its limit or the count cannot be read, so the
 * workflow (.github/workflows/door-count.yml) opens an issue for ShydenMcM.
 * Each line also goes to the job summary.
 */
import { appendFileSync } from 'node:fs';
import { runIfEntry } from './cli.ts';

/** Each door Worker's daily request limit (decision 197). */
export const LIMITS: Readonly<Record<string, number>> = { 'shytalk-door-test': 20_000, 'shytalk-door-dev': 10_000 };

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DAY_MS = 24 * 60 * 60 * 1000;

const QUERY = `query DoorCount($accountTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since, datetime_lt: $until }) {
        sum { requests }
        dimensions { scriptName }
      }
    }
  }
}`;

interface Answer {
  data?: {
    viewer?: { accounts?: { workersInvocationsAdaptive?: { sum: { requests: number }; dimensions: { scriptName: string } }[] }[] };
  } | null;
  errors?: { message: string }[] | null;
}

/** Each door's requests over the 24 hours before `now`; a door with no rows counts 0. */
export async function countDoors(send: Fetch, token: string, account: string, now: Date): Promise<Record<string, number>> {
  const response = await send(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { accountTag: account, since: new Date(now.getTime() - DAY_MS).toISOString(), until: now.toISOString() },
    }),
  });
  if (!response.ok) throw new Error(`Cloudflare analytics answered ${response.status}`);
  const answer = (await response.json()) as Answer;
  const firstError = answer.errors?.[0];
  if (firstError) throw new Error(`Cloudflare analytics refused the query: ${firstError.message}`);
  const rows = answer.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (rows === undefined) throw new Error(`Cloudflare analytics returned no account ${account}`);

  const counts: Record<string, number> = Object.fromEntries(Object.keys(LIMITS).map((door) => [door, 0]));
  for (const { sum, dimensions } of rows) {
    if (dimensions.scriptName in counts) counts[dimensions.scriptName] = (counts[dimensions.scriptName] as number) + sum.requests;
  }
  return counts;
}

/** One line per door; not ok when any door is over its limit. */
export function judge(counts: Record<string, number>): { ok: boolean; lines: string[] } {
  let ok = true;
  const lines = Object.entries(LIMITS).map(([door, limit]) => {
    const count = counts[door] as number;
    const line = `${door}: ${String(count)} requests in the past day (limit ${String(limit)})`;
    if (count <= limit) return line;
    ok = false;
    return `${line}: OVER THE LIMIT`;
  });
  return { ok, lines };
}

/** Writes a line to stdout and, in a job, to its summary. */
function report(line: string): void {
  process.stdout.write(`door-count: ${line}\n`);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `- ${line}\n`);
}

export async function main(
  args: string[] = [],
  env: Record<string, string | undefined> = process.env,
  send: Fetch = (url, init) => fetch(url, init),
  now: Date = new Date(),
  write: (line: string) => void = report,
): Promise<number> {
  if (args.length > 0) throw new Error('usage: node scripts/door-count.ts (no arguments)');
  try {
    for (const name of ['CLOUDFLARE_ANALYTICS_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
      if (!env[name]) throw new Error(`${name} is empty`);
    }
    const { ok, lines } = judge(
      await countDoors(send, env['CLOUDFLARE_ANALYTICS_TOKEN'] as string, env['CLOUDFLARE_ACCOUNT_ID'] as string, now),
    );
    for (const line of lines) write(line);
    return ok ? 0 : 1;
  } catch (error) {
    write(`the door count could not be read: ${(error as Error).message}`);
    return 1;
  }
}

await runIfEntry(import.meta.url, main);
