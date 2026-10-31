// A unit test starts no process and opens no connection (shyden-labs/repo-template#92). tests/setup/unit-refusal.ts installs these refusals on Node's own
// modules before every unit file; a test that needs a process or a socket
// stands the dependency in, or moves to an integration suite.

/** Marks the globals once the refusals are installed; it holds the entries refused. */
export const REFUSED = Symbol.for('repo-template.unit-refusal');

const PROCESS = 'A unit test starts no process.';
const CONNECTION = 'A unit test opens no connection.';
const LOOKUP = 'A unit test looks up no address.';

type Owner = object;
type Prototyped = { prototype: Owner };

/** The parts of Node's modules the refusals replace; Node's own modules fit, and so do stand-ins. */
export type Refusable = {
  childProcess: Owner & { ChildProcess: Prototyped };
  net: Owner & { Socket: Prototyped };
  tls: Owner;
  dgram: { Socket: Prototyped };
  dns: Owner & { Resolver: Prototyped; promises: Owner & { Resolver: Prototyped } };
  globals: Owner;
};

type Entry = [owner: Owner, key: string, entry: string, reason: string];

const CHILD_PROCESS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

/**
 * The dns functions that reach a resolver. Found at run time, because Node
 * adds record types (resolveTlsa is recent); tests/unit/unit-refusal.test.ts
 * pins the list this run refused.
 */
function lookups(owner: Owner, where: string): Entry[] {
  const names = Object.getOwnPropertyNames(owner)
    .filter((name) => /^(lookup|resolve|reverse)/.test(name) && typeof Reflect.get(owner, name) === 'function')
    .sort();
  if (names.length === 0) throw new Error(`unit refusals found no lookup, resolve or reverse function on ${where}`);
  return names.map((name) => [owner, name, `${where}${name}`, LOOKUP]);
}

function entries(m: Refusable): Entry[] {
  return [
    ...CHILD_PROCESS.map((key): Entry => [m.childProcess, key, `child_process.${key}`, PROCESS]),
    // Every start that is not synchronous constructs a ChildProcess and calls
    // its spawn, cluster.fork included, whatever name it was reached by.
    [m.childProcess.ChildProcess.prototype, 'spawn', 'ChildProcess#spawn', PROCESS],
    [m.net, 'connect', 'net.connect', CONNECTION],
    [m.net, 'createConnection', 'net.createConnection', CONNECTION],
    // http, https, http2 and tls all connect through a net.Socket.
    [m.net.Socket.prototype, 'connect', 'net.Socket#connect', CONNECTION],
    [m.tls, 'connect', 'tls.connect', CONNECTION],
    [m.dgram.Socket.prototype, 'send', 'dgram.Socket#send', CONNECTION],
    [m.dgram.Socket.prototype, 'connect', 'dgram.Socket#connect', CONNECTION],
    ...lookups(m.dns, 'dns.'),
    ...lookups(m.dns.promises, 'dns.promises.'),
    ...lookups(m.dns.Resolver.prototype, 'dns.Resolver#'),
    ...lookups(m.dns.promises.Resolver.prototype, 'dns.promises.Resolver#'),
    // Node's fetch and WebSocket connect without reaching net.Socket#connect
    // where a refusal could name them. EventSource is not a global in Node 26.
    [m.globals, 'fetch', 'fetch', CONNECTION],
    [m.globals, 'WebSocket', 'WebSocket', CONNECTION],
  ];
}

/**
 * Replaces every entry with one that throws, naming the test running at the
 * call; returns the entries refused. Installing twice refuses nothing new. An
 * entry that is missing fails the install, so a refusal can never lapse
 * unseen when Node changes.
 */
/** Who a refusal names: the running test, or, while files load and suites collect, no test at all. */
export function testName(state: { currentTestName?: string }): string {
  return state.currentTestName ?? '(outside a test)';
}

export function installRefusals(m: Refusable, who: () => string): string[] {
  if (Reflect.has(m.globals, REFUSED)) return [];
  const planned = entries(m);
  for (const [owner, key, entry] of planned) {
    if (typeof Reflect.get(owner, key) !== 'function') {
      throw new Error(`unit refusals cannot refuse ${entry}: it is not a function here`);
    }
  }
  for (const [owner, key, entry, reason] of planned) {
    const refused = function refused(): never {
      throw new Error(
        `unit test refused: "${who()}" called ${entry}. ${reason} Stand the dependency in, or move the case to an integration suite (#92).`,
      );
    };
    Object.defineProperty(owner, key, { value: refused, writable: true, configurable: true });
  }
  const refusedEntries = planned.map(([, , entry]) => entry);
  Object.defineProperty(m.globals, REFUSED, { value: refusedEntries });
  return refusedEntries;
}
