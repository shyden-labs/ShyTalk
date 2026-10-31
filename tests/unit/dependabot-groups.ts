/**
 * Dependabot's group assignment, as dependabot-core does it (issue shyden-labs/repo-template#39;
 * Shyden 2026-10-20, "global fix please"). Since dependabot/dependabot-core#13098 a
 * dependency is offered to every group whose `contains?` is true, and the
 * group whose patterns score highest keeps it: a group with no patterns scores
 * 500, above any wildcard (`actions/cache*` 99, `@vitest/*` 94). So order
 * decides nothing, and the one safe shape is a catch-all that excludes each
 * pattern group's patterns, leaving one group able to hold each package.
 *
 * `parseGroups` reads the YAML the template writes (comments and quotes
 * already stripped) and fails closed on any line or group rule it does not
 * model, rather than judging part of a group.
 */

export interface Group {
  name: string;
  patterns: string[];
  excludePatterns: string[];
  updateTypes: string[];
}

export interface Ecosystem {
  ecosystem: string;
  groups: Group[];
}

/** The group keys modelled here, and where each one's list goes. */
const KEYS = {
  patterns: 'patterns',
  'exclude-patterns': 'excludePatterns',
  'update-types': 'updateTypes',
} as const;

type ListKey = (typeof KEYS)[keyof typeof KEYS];

/** Every ecosystem in the config, with its groups. */
export function parseGroups(config: string): Ecosystem[] {
  const ecosystems: Ecosystem[] = [];
  let ecosystem: Ecosystem | undefined;
  let group: Group | undefined;
  let list: ListKey | undefined;
  let inGroups = false;
  const lines = config.split('\n');
  lines.forEach((line, i) => {
    const unreadable = () => new Error(`cannot read line ${i + 1} of the groups: "${line}"`);
    const opened = /^\s*-\s*package-ecosystem:\s*(\S+)\s*$/.exec(line);
    if (opened) {
      ecosystem = { ecosystem: opened[1] as string, groups: [] };
      ecosystems.push(ecosystem);
      inGroups = false;
      return;
    }
    if (line === '    groups:') {
      if (ecosystem === undefined) throw unreadable();
      inGroups = true;
      group = undefined;
      list = undefined;
      return;
    }
    if (!inGroups || line.trim() === '') return;
    if (/^ {0,4}\S/.test(line)) {
      inGroups = false;
      return;
    }
    const named = /^ {6}([^\s:]+):$/.exec(line);
    if (named) {
      group = { name: named[1] as string, patterns: [], excludePatterns: [], updateTypes: [] };
      (ecosystem as Ecosystem).groups.push(group);
      list = undefined;
      return;
    }
    const keyed = /^ {8}([^\s:]+):$/.exec(line);
    if (keyed && group !== undefined) {
      const key = keyed[1] as string;
      if (!(key in KEYS)) throw new Error(`group ${group.name} uses ${key}, which this guard does not model`);
      list = KEYS[key as keyof typeof KEYS];
      return;
    }
    const item = /^ {10}- (\S+)$/.exec(line);
    if (item && group !== undefined && list !== undefined) {
      group[list].push(item[1] as string);
      return;
    }
    throw unreadable();
  });
  return ecosystems;
}

/** A Dependabot pattern as a regex: `*` is any run, case is ignored, every other character is literal. */
const glob = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );

/** dependabot-core's `DependencyGroup#contains?` for the rules modelled here. */
export function contains(group: Group, name: string): boolean {
  if (group.excludePatterns.some((p) => glob(p).test(name))) return false;
  return group.patterns.length === 0 || group.patterns.some((p) => glob(p).test(name));
}

/**
 * Every way a pattern group's package could land in another group of the same
 * ecosystem. Each pattern is tried as a name with every `*` read as nothing
 * and as `x/y`, so a catch-all that misses the bare name or a sub-path is named.
 */
export function leaks({ ecosystem, groups }: Ecosystem): string[] {
  return groups.flatMap((owner) =>
    owner.patterns.flatMap((pattern) =>
      [...new Set([pattern.replaceAll('*', ''), pattern.replaceAll('*', 'x/y')])].flatMap((name) =>
        groups
          .filter((other) => other !== owner && contains(other, name))
          .map((other) => `${ecosystem}: ${name} (${owner.name} group, ${pattern}) can also land in ${other.name}`),
      ),
    ),
  );
}
