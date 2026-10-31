import { describe, expect, it, vi } from 'vitest';
import * as childProcessNamespace from 'node:child_process';
import childProcessDefault, { execFileSync, spawn } from 'node:child_process';
import cluster from 'node:cluster';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import http2 from 'node:http2';
import { createRequire } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { REFUSED, installRefusals, testName } from '../setup/refusals.ts';

/**
 * A unit test starts no process and opens no connection (shyden-labs/repo-template#92). The refusals are installed by tests/setup/unit-refusal.ts
 * before every unit file; here they are first installed on stand-in modules,
 * one test per entry, then tried live in this very run by every route a test
 * could take.
 */

// Stand-ins a refusal replaces, so their bodies never run: a mocked return, not a function literal left unrun.
const reached = () => vi.fn().mockReturnValue('reached');

function standIns() {
  return {
    childProcess: {
      spawn: reached(),
      spawnSync: reached(),
      exec: reached(),
      execSync: reached(),
      execFile: reached(),
      execFileSync: reached(),
      fork: reached(),
      ChildProcess: { prototype: { spawn: reached() } },
    },
    net: { connect: reached(), createConnection: reached(), Socket: { prototype: { connect: reached() } } },
    tls: { connect: reached() },
    dgram: { Socket: { prototype: { send: reached(), connect: reached() } } },
    dns: {
      lookup: reached(),
      resolve4: reached(),
      reverse: reached(),
      getServers: reached(),
      Resolver: { prototype: { resolveTxt: reached(), setServers: reached() } },
      promises: {
        lookupService: reached(),
        resolve: reached(),
        getServers: reached(),
        Resolver: { prototype: { reverse: reached() } },
      },
    },
    globals: { fetch: reached(), WebSocket: reached() } as Record<string | symbol, unknown>,
  };
}
type StandIns = ReturnType<typeof standIns>;

const PROCESS = 'A unit test starts no process.';
const CONNECTION = 'A unit test opens no connection.';
const LOOKUP = 'A unit test looks up no address.';

/** Every entry the stand-ins carry, where it lives, and why it is refused. */
const ENTRIES: [entry: string, at: (m: StandIns) => object, key: string, reason: string][] = [
  ['child_process.spawn', (m) => m.childProcess, 'spawn', PROCESS],
  ['child_process.spawnSync', (m) => m.childProcess, 'spawnSync', PROCESS],
  ['child_process.exec', (m) => m.childProcess, 'exec', PROCESS],
  ['child_process.execSync', (m) => m.childProcess, 'execSync', PROCESS],
  ['child_process.execFile', (m) => m.childProcess, 'execFile', PROCESS],
  ['child_process.execFileSync', (m) => m.childProcess, 'execFileSync', PROCESS],
  ['child_process.fork', (m) => m.childProcess, 'fork', PROCESS],
  ['ChildProcess#spawn', (m) => m.childProcess.ChildProcess.prototype, 'spawn', PROCESS],
  ['net.connect', (m) => m.net, 'connect', CONNECTION],
  ['net.createConnection', (m) => m.net, 'createConnection', CONNECTION],
  ['net.Socket#connect', (m) => m.net.Socket.prototype, 'connect', CONNECTION],
  ['tls.connect', (m) => m.tls, 'connect', CONNECTION],
  ['dgram.Socket#send', (m) => m.dgram.Socket.prototype, 'send', CONNECTION],
  ['dgram.Socket#connect', (m) => m.dgram.Socket.prototype, 'connect', CONNECTION],
  ['dns.lookup', (m) => m.dns, 'lookup', LOOKUP],
  ['dns.resolve4', (m) => m.dns, 'resolve4', LOOKUP],
  ['dns.reverse', (m) => m.dns, 'reverse', LOOKUP],
  ['dns.promises.lookupService', (m) => m.dns.promises, 'lookupService', LOOKUP],
  ['dns.promises.resolve', (m) => m.dns.promises, 'resolve', LOOKUP],
  ['dns.Resolver#resolveTxt', (m) => m.dns.Resolver.prototype, 'resolveTxt', LOOKUP],
  ['dns.promises.Resolver#reverse', (m) => m.dns.promises.Resolver.prototype, 'reverse', LOOKUP],
  ['fetch', (m) => m.globals, 'fetch', CONNECTION],
  ['WebSocket', (m) => m.globals, 'WebSocket', CONNECTION],
];

const call = (owner: object, key: string): unknown => (Reflect.get(owner, key) as () => unknown)();

describe('testName', () => {
  it('names the running test', () => {
    expect(testName({ currentTestName: 'a > one' })).toBe('a > one');
  });

  it('says no test is running while files load and suites collect', () => {
    expect(testName({})).toBe('(outside a test)');
  });
});

describe('installRefusals, on stand-in modules', () => {
  it.each(ENTRIES)('refuses %s, naming the test and the entry, and never reaches the real one', (entry, at, key, reason) => {
    const m = standIns();
    const real = Reflect.get(at(m), key) as ReturnType<typeof reached>;
    installRefusals(m, () => 'suite > t');
    expect(() => call(at(m), key)).toThrow(
      `unit test refused: "suite > t" called ${entry}. ${reason} Stand the dependency in, or move the case to an integration suite (#92).`,
    );
    expect(real).not.toHaveBeenCalled();
  });

  it('returns every entry it refused, in order', () => {
    expect(installRefusals(standIns(), vi.fn().mockReturnValue('t'))).toEqual(ENTRIES.map(([entry]) => entry));
  });

  it('records what it refused on the globals, under its mark', () => {
    const m = standIns();
    installRefusals(m, vi.fn().mockReturnValue('t'));
    expect(m.globals[REFUSED]).toEqual(ENTRIES.map(([entry]) => entry));
  });

  it('leaves alone every dns function that looks up nothing', () => {
    const m = standIns();
    const kept = [m.dns.getServers, m.dns.Resolver.prototype.setServers, m.dns.promises.getServers];
    installRefusals(m, vi.fn().mockReturnValue('t'));
    expect([m.dns.getServers, m.dns.Resolver.prototype.setServers, m.dns.promises.getServers]).toEqual(kept);
  });

  it('wraps once when installed twice, and the second install refuses nothing new', () => {
    const m = standIns();
    installRefusals(m, () => 'first');
    const refused = m.childProcess.execFileSync;
    expect(installRefusals(m, vi.fn().mockReturnValue('second'))).toEqual([]);
    expect(m.childProcess.execFileSync).toBe(refused);
    expect(() => call(m.childProcess, 'execFileSync')).toThrow('"first" called child_process.execFileSync');
  });

  it('names the test running at the call, not at the install', () => {
    const m = standIns();
    let running = 'at install';
    installRefusals(m, () => running);
    running = 'a > later test';
    expect(() => call(m.net, 'connect')).toThrow('"a > later test" called net.connect');
  });

  it('refuses a class constructed with new', () => {
    const m = standIns();
    installRefusals(m, vi.fn().mockReturnValue('t'));
    const WebSocketRefused = m.globals.WebSocket as new (url: string) => unknown;
    expect(() => new WebSocketRefused('ws://127.0.0.1')).toThrow('called WebSocket');
  });

  it('fails closed when an entry it must refuse is missing', () => {
    const m = standIns();
    Reflect.deleteProperty(m.tls, 'connect');
    expect(() => installRefusals(m, vi.fn().mockReturnValue('t'))).toThrow('cannot refuse tls.connect: it is not a function here');
  });

  it('fails closed when a dns population holds no lookup', () => {
    const m = standIns();
    Reflect.deleteProperty(m.dns.Resolver.prototype, 'resolveTxt');
    expect(() => installRefusals(m, vi.fn().mockReturnValue('t'))).toThrow('found no lookup, resolve or reverse function on dns.Resolver#');
  });
});

/** The refusal a live call in this run must meet: it names the running test and the entry. */
const refusedLive = (entry: string) =>
  new RegExp(`^unit test refused: "the refusals in this run > .+" called ${entry.replaceAll('.', '\\.')}\\. `);

describe('the refusals in this run', () => {
  it('refuses every process, connection and lookup entry of Node 26', () => {
    // The dns names are found at run time (Node's own list); each is pinned here.
    const dnsNames = [
      'lookup',
      'lookupService',
      'resolve',
      'resolve4',
      'resolve6',
      'resolveAny',
      'resolveCaa',
      'resolveCname',
      'resolveMx',
      'resolveNaptr',
      'resolveNs',
      'resolvePtr',
      'resolveSoa',
      'resolveSrv',
      'resolveTlsa',
      'resolveTxt',
      'reverse',
    ];
    const resolverNames = dnsNames.filter((name) => !name.startsWith('lookup'));
    expect(Reflect.get(globalThis, REFUSED)).toEqual([
      'child_process.spawn',
      'child_process.spawnSync',
      'child_process.exec',
      'child_process.execSync',
      'child_process.execFile',
      'child_process.execFileSync',
      'child_process.fork',
      'ChildProcess#spawn',
      'net.connect',
      'net.createConnection',
      'net.Socket#connect',
      'tls.connect',
      'dgram.Socket#send',
      'dgram.Socket#connect',
      ...dnsNames.map((name) => `dns.${name}`),
      ...dnsNames.map((name) => `dns.promises.${name}`),
      ...resolverNames.map((name) => `dns.Resolver#${name}`),
      ...resolverNames.map((name) => `dns.promises.Resolver#${name}`),
      'fetch',
      'WebSocket',
    ]);
  });

  it('refuses execFileSync imported by name', () => {
    expect(() => execFileSync('true')).toThrow(refusedLive('child_process.execFileSync'));
  });

  it('refuses execFileSync through a namespace import', () => {
    expect(() => childProcessNamespace.execFileSync('true')).toThrow(refusedLive('child_process.execFileSync'));
  });

  it('refuses execFileSync through the default import', () => {
    expect(() => childProcessDefault.execFileSync('true')).toThrow(refusedLive('child_process.execFileSync'));
  });

  it('refuses execFileSync through createRequire', () => {
    const required = createRequire(import.meta.url)('node:child_process') as typeof childProcessDefault;
    expect(() => required.execFileSync('true')).toThrow(refusedLive('child_process.execFileSync'));
  });

  it('refuses execFileSync through a dynamic import', async () => {
    const imported = await import('node:child_process');
    expect(() => imported.execFileSync('true')).toThrow(refusedLive('child_process.execFileSync'));
  });

  it('refuses spawn', () => {
    expect(() => spawn('true')).toThrow(refusedLive('child_process.spawn'));
  });

  it('refuses a ChildProcess spawned by hand, the route every async start takes', () => {
    // spawn is internal to Node and missing from its types; cluster.fork and every async start call it.
    const child = new childProcessDefault.ChildProcess();
    const spawnChild = Reflect.get(child, 'spawn') as (options: object) => unknown;
    expect(() => spawnChild.call(child, { file: 'true', args: ['true'] })).toThrow(refusedLive('ChildProcess#spawn'));
  });

  it('refuses cluster.fork, which no child_process name of its own reaches', () => {
    cluster.setupPrimary({ exec: '/dev/null', silent: true });
    expect(() => cluster.fork()).toThrow(/^unit test refused: ".+" called (child_process\.fork|ChildProcess#spawn)\. /);
  });

  it('refuses a TCP connection to loopback', () => {
    expect(() => net.connect(9, '127.0.0.1')).toThrow(refusedLive('net.connect'));
  });

  it('refuses a socket connected by hand', () => {
    expect(() => new net.Socket().connect(9, '127.0.0.1')).toThrow(refusedLive('net.Socket#connect'));
  });

  it('refuses a unix socket', () => {
    expect(() => net.connect({ path: '/tmp/repo-template-refused.sock' })).toThrow(refusedLive('net.connect'));
  });

  it('refuses tls.connect', () => {
    expect(() => tls.connect(9, '127.0.0.1')).toThrow(refusedLive('tls.connect'));
  });

  it('refuses http.get, which connects through a socket', () => {
    expect(() => http.get('http://127.0.0.1:9/')).toThrow(refusedLive('net.createConnection'));
  });

  it('refuses http2.connect, which connects through a socket', () => {
    expect(() => http2.connect('http://127.0.0.1:9')).toThrow(
      /^unit test refused: ".+" called net\.(connect|createConnection|Socket#connect)\. /,
    );
  });

  it('refuses fetch, even of a data URL that needs no network', () => {
    expect(() => fetch('data:,x')).toThrow(refusedLive('fetch'));
  });

  it('refuses a WebSocket', () => {
    expect(() => new WebSocket('ws://127.0.0.1:9')).toThrow(refusedLive('WebSocket'));
  });

  it('refuses a UDP send', () => {
    const socket = dgram.createSocket('udp4');
    try {
      expect(() => {
        socket.send('x', 9, '127.0.0.1');
      }).toThrow(refusedLive('dgram.Socket#send'));
    } finally {
      socket.close();
    }
  });

  it('refuses dns.lookup', () => {
    expect(() => {
      dns.lookup('localhost', vi.fn());
    }).toThrow(refusedLive('dns.lookup'));
  });

  it('refuses dns.promises.resolve4', () => {
    expect(() => dns.promises.resolve4('localhost')).toThrow(refusedLive('dns.promises.resolve4'));
  });
});
