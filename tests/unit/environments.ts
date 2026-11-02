import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The environment checks (plan 2 Task E3, shyden-labs/ShyTalk#29). Pure
 * functions over parsed configs and file text, so each rule is tested on
 * fixtures as well as on the real tree (environments.test.ts).
 */

/** environments.json: each environment's store ids (ids, not secrets). */
export type EnvironmentsFile = Record<string, { d1: string[]; kv: string[]; r2: string[] }>;

/** A Wrangler config found in the tree; `config` is null when it is not JSON. */
export interface FoundConfig {
  path: string;
  config: unknown;
}

/** Each binding list a config can hold, the kind it is listed under, and the keys holding an id. */
const BINDINGS = [
  { list: 'd1_databases', kind: 'd1', keys: ['database_id', 'preview_database_id'] },
  { list: 'kv_namespaces', kind: 'kv', keys: ['id', 'preview_id'] },
  { list: 'r2_buckets', kind: 'r2', keys: ['bucket_name', 'preview_bucket_name'] },
] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every way the configs or environments.json let one environment reach another's store. */
export function environmentProblems(configs: FoundConfig[], listed: EnvironmentsFile): string[] {
  const owner = new Map<string, string>();
  const problems: string[] = [];

  for (const [environment, stores] of Object.entries(listed)) {
    for (const id of [...stores.d1, ...stores.kv, ...stores.r2]) {
      const earlier = owner.get(id);
      if (earlier === undefined) owner.set(id, environment);
      else problems.push(`environments.json lists ${id} under both ${earlier} and ${environment}`);
    }
  }

  for (const { path, config } of configs) {
    if (!path.endsWith('/wrangler.json') && path !== 'wrangler.json') {
      problems.push(`${path}: write Wrangler configs as wrangler.json`);
      continue;
    }
    if (!isObject(config)) {
      problems.push(`${path} is not a JSON object`);
      continue;
    }
    for (const { list } of BINDINGS) {
      if (list in config) problems.push(`${path} top level binds ${list}: bind stores only inside env.<environment>`);
    }
    const environments = config['env'] ?? {};
    if (!isObject(environments)) {
      problems.push(`${path} env is not an object`);
      continue;
    }
    for (const [environment, block] of Object.entries(environments)) {
      const where = `${path} env.${environment}`;
      if (!(environment in listed)) {
        problems.push(`${where} is not an environment in environments.json`);
        continue;
      }
      if (!isObject(block)) {
        problems.push(`${where} is not an object`);
        continue;
      }
      for (const { list, kind, keys } of BINDINGS) {
        const entries = block[list];
        if (entries === undefined) continue;
        if (!Array.isArray(entries)) {
          problems.push(`${where} ${list} is not a list`);
          continue;
        }
        for (const entry of entries as unknown[]) {
          if (!isObject(entry)) {
            problems.push(`${where} ${list} holds an entry that is not a binding object`);
            continue;
          }
          for (const key of keys) {
            const id = entry[key];
            if (id === undefined) continue;
            const name = typeof entry['binding'] === 'string' ? entry['binding'] : '(unnamed)';
            if (typeof id !== 'string') {
              problems.push(`${where} ${kind} ${name} ${key} is not a string`);
              continue;
            }
            const listedUnder = owner.get(id);
            const binding = `${where} ${kind} ${name} ${key} ${id}`;
            if (listedUnder === undefined) problems.push(`${binding} is listed under no environment`);
            else if (listedUnder !== environment) problems.push(`${binding} is listed under ${listedUnder}, not ${environment}`);
          }
        }
      }
    }
  }
  return problems;
}

/** The hosts a door answers on, from its routes (`{ pattern }` or a bare `host/path*` string). */
export function doorHosts(config: unknown): string[] {
  const environments = isObject(config) && isObject(config['env']) ? config['env'] : {};
  const hosts = Object.values(environments).flatMap((settings) => {
    const routes = isObject(settings) && Array.isArray(settings['routes']) ? (settings['routes'] as unknown[]) : [];
    return routes.map((route) => {
      const pattern = isObject(route) ? String(route['pattern']) : String(route);
      return (pattern.split('/')[0] as string).toLowerCase();
    });
  });
  if (hosts.length === 0) throw new Error('the door config names no route');
  return hosts;
}

/** One line per file naming a door host, in any letter case. */
export function hostMentions(files: { path: string; text: string }[], hosts: string[]): string[] {
  return files.flatMap(({ path, text }) => {
    const lower = text.toLowerCase();
    return hosts.filter((host) => lower.includes(host)).map((host) => `${path} names the door host ${host}`);
  });
}

/** Folders never walked: installed, generated, or git-ignored working state. */
const SKIPPED = new Set(['node_modules', '.git', 'coverage', '.wrangler', '.superpowers', '.claude', '.vite']);

/** Every file under `root` (relative paths) whose name `keep` accepts, walked in-process. */
export function filesUnder(root: string, keep: (name: string) => boolean): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = root === '.' ? entry.name : join(root, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : filesUnder(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}
