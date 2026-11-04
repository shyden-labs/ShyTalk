/**
 * THROWAWAY door spike, version 2 (plan 2 Task E6 Step 3, shyden-labs/ShyTalk#31;
 * Shyden 2026-11-04). Never merged: it runs on its own pull request, from a GitHub
 * runner (Linux, passwordless sudo), through wss://dev.shytalk.app/ws. Three
 * phases, every event a timestamped JSON line:
 *   1. hold:   one socket for HOLD_MS, a ping a minute, each alarm timed by the
 *              server's own stamp (lagMs = arrival - server time); then close 4000.
 *   2. resume: a new socket on the same room for RESUME_MS; the alarm count continues.
 *   3. cut:    a socket whose traffic is then dropped at the firewall (no close, no
 *              reset: what a phone losing signal looks like). A second socket asks
 *              the room every 5 s how many sockets it holds, timing how long the
 *              dead one stays counted, capped at CUT_CAP_MS.
 */
import { execFileSync } from 'node:child_process';

const URL_BASE = 'wss://dev.shytalk.app/ws';
const HOLD_MS = Number(process.env.HOLD_MS ?? 30 * 60_000);
const RESUME_MS = Number(process.env.RESUME_MS ?? 2 * 60_000);
const CUT_CAP_MS = Number(process.env.CUT_CAP_MS ?? 15 * 60_000);
const room = `spike-${String(Date.now())}`;
const t0 = Date.now();

const log = (event: string, extra: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ t: new Date().toISOString(), sinceStartS: Math.round((Date.now() - t0) / 1000), event, ...extra }));
};
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const run = (file: string, args: string[]): string => execFileSync(file, args, { encoding: 'utf8' });

/** Drops (`-I`) or restores (`-D`) every packet of one local TCP port, both ways. */
const iptables = (op: '-I' | '-D', port: string): void => {
  if (!/^\d+$/.test(port)) throw new Error(`not a port: ${port}`);
  run('sudo', ['iptables', op, 'INPUT', '-p', 'tcp', '--dport', port, '-j', 'DROP']);
  run('sudo', ['iptables', op, 'OUTPUT', '-p', 'tcp', '--sport', port, '-j', 'DROP']);
};

/** The runner's established :443 connections, by local port. */
const localPorts = (): Set<string> =>
  new Set(
    run('ss', ['-tnH', 'state', 'established', '( dport = :443 )'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/)[2]?.split(':').at(-1) ?? ''),
  );

interface Session {
  label: string;
  ws: WebSocket;
  alarms: number[];
  lags: number[];
  echoes: number[];
  counts: number[];
  closeCode: number | null;
  closedAt: number | null;
  error: string | null;
  ping(text: string): void;
  closed: Promise<void>;
}

interface ServerMessage {
  alarm?: number;
  sockets?: number;
  echo?: string;
  at: number;
}

/** Opens a socket on the room; resolves once it is open. */
function open(label: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const sent = new Map<string, number>();
    const ws = new WebSocket(`${URL_BASE}?id=${room}`);
    let markClosed: () => void = () => undefined;
    const s: Session = {
      label,
      ws,
      alarms: [],
      lags: [],
      echoes: [],
      counts: [],
      closeCode: null,
      closedAt: null,
      error: null,
      ping(text) {
        sent.set(text, Date.now());
        ws.send(text);
      },
      closed: new Promise((done) => {
        markClosed = done;
      }),
    };
    ws.addEventListener('open', () => {
      log('open', { label, connectMs: Date.now() - started });
      resolve(s);
    });
    ws.addEventListener('message', (e: MessageEvent) => {
      const m = JSON.parse(String(e.data)) as ServerMessage;
      const lag = Date.now() - m.at;
      if (m.alarm !== undefined) {
        s.alarms.push(m.alarm);
        s.lags.push(lag);
        log('alarm', { label, alarm: m.alarm, lagMs: lag });
      } else if (m.sockets !== undefined) {
        s.counts.push(m.sockets);
        log('sockets', { label, sockets: m.sockets });
      } else if (m.echo !== undefined) {
        const rtt = Date.now() - (sent.get(m.echo) ?? Date.now());
        s.echoes.push(rtt);
        log('echo', { label, echo: m.echo, rttMs: rtt });
      }
    });
    ws.addEventListener('error', () => {
      s.error = 'error event';
      log('error', { label });
      reject(new Error(`${label}: socket error`));
    });
    ws.addEventListener('close', (e: CloseEvent) => {
      s.closeCode = e.code;
      s.closedAt = Date.now();
      log('close', { label, code: e.code, reason: e.reason, heldS: Math.round((Date.now() - started) / 1000) });
      markClosed();
    });
  });
}

const stats = (xs: number[]): Record<string, number> => {
  const v = [...xs].sort((a, b) => a - b);
  const at = (i: number): number => v[Math.min(i, v.length - 1)] ?? -1;
  return { n: v.length, min: at(0), median: at(Math.floor(v.length / 2)), p95: at(Math.floor(v.length * 0.95)), max: at(v.length - 1) };
};

/** Phases 1 and 2: a polite hold, then close 4000. */
async function holdThenClose(label: string, ms: number): Promise<Session> {
  const s = await open(label);
  let n = 0;
  const pinger = setInterval(() => {
    n += 1;
    s.ping(`ping ${String(n)}`);
  }, 60_000);
  await sleep(ms);
  clearInterval(pinger);
  log('drop', { label, how: 'close 4000' });
  s.ws.close(4000, 'spike drop');
  await s.closed;
  return s;
}

log('start', { room, holdMs: HOLD_MS, resumeMs: RESUME_MS, cutCapMs: CUT_CAP_MS });
const hold = await holdThenClose('hold', HOLD_MS);
const resume = await holdThenClose('resume', RESUME_MS);

// Phase 3: the real drop.
const before = localPorts();
const dead = await open('cut');
const ports = [...localPorts()].filter((p) => !before.has(p));
const port = ports[0];
if (ports.length !== 1 || port === undefined) throw new Error(`cut: expected one new connection, found ${JSON.stringify(ports)}`);
await sleep(35_000); // one alarm on the soon-dead socket first
iptables('-I', port);
const cutAt = Date.now();
log('cut', { port, how: 'iptables DROP both ways, no close, no reset' });
const probe = await open('probe');
let goneAfterMs: number | null = null;
while (Date.now() - cutAt < CUT_CAP_MS) {
  probe.ws.send('sockets');
  await sleep(5_000);
  if (probe.counts.at(-1) === 1) {
    goneAfterMs = Date.now() - cutAt;
    break;
  }
}
const clientSawCloseAfterMs = dead.closedAt === null ? null : dead.closedAt - cutAt;
log('server-noticed', { goneAfterMs, capMs: CUT_CAP_MS, clientSawCloseAfterMs });
iptables('-D', port);
probe.ws.close(4000, 'spike done');
await probe.closed;

const lastHoldAlarm = hold.alarms.at(-1) ?? 0;
const summary = {
  room,
  hold: {
    alarms: hold.alarms.length,
    first: hold.alarms[0],
    last: lastHoldAlarm,
    lagMs: stats(hold.lags),
    rttMs: stats(hold.echoes),
    closeCode: hold.closeCode,
    error: hold.error,
  },
  resume: { alarms: resume.alarms.length, first: resume.alarms[0], lagMs: stats(resume.lags), closeCode: resume.closeCode },
  cut: { serverDroppedDeadSocketAfterMs: goneAfterMs, clientSawCloseAfterMs, probeCounts: probe.counts },
};
log('summary', summary);
const ok =
  hold.closeCode === 4000 &&
  hold.error === null &&
  hold.alarms.length >= Math.floor(HOLD_MS / 30_000) - 1 &&
  Math.max(...hold.lags) < 2_000 &&
  (resume.alarms[0] ?? 0) > lastHoldAlarm &&
  goneAfterMs !== null;
log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
