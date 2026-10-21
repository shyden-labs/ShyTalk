'use strict';

/**
 * apk-persona-check.js — SHY-0662.
 *
 * Proves that the APKs and AABs in a folder do not hold the dev persona
 * password (the `DEV_QA_PERSONAS_PASSWORD` secret, shared by the seeded dev
 * accounts, the dev admin among them). This repository is public, so any
 * build CI keeps can be downloaded and read by anyone signed in to GitHub.
 *
 * Two proofs (Shyden, 2026-10-21):
 *   1. BuildConfig: the build's own generated `BuildConfig.java` declares the
 *      field once, holding the flavour's expected value ('' for dev and prod,
 *      the emulator's 'localdev123' for local). Needs no secret, so it also
 *      runs on Dependabot PRs, which are given no secrets.
 *   2. Value search: wherever the run has the secret, every entry of every
 *      file is inflated and searched for it as UTF-8 and UTF-16LE, after a
 *      planted APK built here proves the search can find it.
 * It refuses when neither proof can run, when a folder holds no app file,
 * and when a file reads as empty, so an empty read can never pass. It never
 * prints the secret, nor the field's value.
 *
 * Used by .github/actions/apk-holds-no-persona-password. Environment:
 *   APK_DIRS          folders to read, one per line (not recursive)
 *   PERSONA_PASSWORD  the secret; empty when the run has none
 *   BUILD_CONFIG      path of the generated BuildConfig.java (optional)
 *   EXPECTED_FIELD    the flavour's expected field value (default '')
 */

const fs = require('fs');
const zlib = require('zlib');

const FIELD = 'DEV_QA_PERSONAS_PASSWORD';
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64 = 0xffffffff;
const APP_FILE = /\.(apk|aab)$/;

/**
 * Every entry of a zip, read through its central directory and inflated.
 * @param {Buffer} buf
 * @returns {{ name: string, data: Buffer }[]}
 */
function readZipEntries(buf) {
  let eocd = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 0xffff); p--) {
    if (buf.readUInt32LE(p) === EOCD) {
      eocd = p;
      break;
    }
  }
  if (eocd === -1) throw new Error('no end of central directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === ZIP64) throw new Error('zip64 archives are not read');

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) {
      throw new Error(`central directory entry ${i} is not where the directory says`);
    }
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    if (packed === ZIP64 || size === ZIP64 || local === ZIP64)
      throw new Error('zip64 archives are not read');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOCAL) {
      throw new Error(`${name}: local header is not where the directory says`);
    }
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + packed > buf.length) throw new Error(`${name}: data runs past the end of the file`);
    const raw = buf.subarray(start, start + packed);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`${name}: compression method ${method} is not read`);
    if (data.length !== size)
      throw new Error(`${name}: inflated to ${data.length} bytes, recorded ${size}`);
    entries.push({ name, data });
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

/**
 * Whether the bytes hold the secret as UTF-8 (dex strings, which are MUTF-8
 * and the same bytes for this text) or UTF-16LE (resource string pools).
 */
function holdsSecret(bytes, secret) {
  if (!secret) throw new Error('the secret to search for is empty');
  return (
    bytes.includes(Buffer.from(secret, 'utf8')) || bytes.includes(Buffer.from(secret, 'utf16le'))
  );
}

/** The value a generated BuildConfig.java gives the field, declared exactly once. */
function buildConfigField(text, field) {
  const re = new RegExp(`\\bString\\s+${field}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")\\s*;`, 'g');
  const found = [...text.matchAll(re)];
  if (found.length !== 1)
    throw new Error(`BuildConfig declares ${field} ${found.length} times, not once`);
  return JSON.parse(found[0][1]);
}

/**
 * A zip of the given entries (deflated unless `method` says otherwise). Used
 * for the planted APK and by the tests; the claim and gap options write a
 * damaged or padded file on purpose.
 * @param {{ name: string, data: Buffer, method?: number, claimSize?: number, claimUncompressed?: number }[]} entries
 * @param {{ gap?: number }} [options] bytes of padding before the central directory, as a signing block leaves
 */
function zipOf(entries, { gap = 0 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const packed = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(e.claimSize ?? packed.length, 20);
    central.writeUInt32LE(e.claimUncompressed ?? e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset + gap, 16);
  return Buffer.concat([...locals, Buffer.alloc(gap), directory, end]);
}

/**
 * @param {{
 *   dir: string,
 *   apps: { path: string, bytes: Buffer }[],
 *   secret: string,
 *   buildConfig: { path: string, text: string, expected: string } | null,
 *   search?: (bytes: Buffer, secret: string) => boolean,
 * }} input
 * @returns {{ ok: boolean, lines: string[] }}
 */
function check({ dir, apps, secret, buildConfig, search = holdsSecret }) {
  if (apps.length === 0) return { ok: false, lines: [`${dir}: no .apk or .aab file to read`] };
  const lines = [];
  const read = [];
  for (const { path, bytes } of apps) {
    let entries;
    try {
      entries = readZipEntries(bytes);
    } catch (err) {
      return { ok: false, lines: [...lines, `${path}: cannot be read: ${err.message}`] };
    }
    const inflated = entries.reduce((n, e) => n + e.data.length, 0);
    lines.push(
      `${path}: ${bytes.length} bytes, ${entries.length} entries, ${inflated} bytes inflated`,
    );
    if (entries.length === 0 || inflated === 0) {
      return {
        ok: false,
        lines: [
          ...lines,
          `${path}: read ${entries.length} entries and ${inflated} bytes, so nothing was searched`,
        ],
      };
    }
    read.push({ path, entries });
  }

  const proofs = [];
  let ok = true;
  if (buildConfig) {
    let value;
    try {
      value = buildConfigField(buildConfig.text, FIELD);
    } catch (err) {
      return {
        ok: false,
        lines: [...lines, `${buildConfig.path}: cannot be read: ${err.message}`],
      };
    }
    if (value === buildConfig.expected) {
      lines.push(`${buildConfig.path}: ${FIELD} is the flavour's expected value`);
    } else {
      ok = false;
      lines.push(
        `${buildConfig.path}: ${FIELD} is NOT the flavour's expected value (it holds ${value.length} characters)`,
      );
    }
    proofs.push('BuildConfig field');
  }

  if (secret) {
    const planted = readZipEntries(
      zipOf([{ name: 'classes.dex', data: Buffer.from(`dex ${secret} dex`) }]),
    );
    if (!planted.some((e) => search(e.data, secret))) {
      return {
        ok: false,
        lines: [
          ...lines,
          'planted APK: the search did NOT find the secret, so it cannot be trusted',
        ],
      };
    }
    lines.push('planted APK: the search finds the secret, so it can see it');
    for (const { path, entries } of read) {
      const holding = entries.filter((e) => search(e.data, secret)).map((e) => e.name);
      if (holding.length > 0) {
        ok = false;
        lines.push(`${path}: HOLDS the secret in ${holding.join(', ')}`);
      } else {
        lines.push(`${path}: the secret is not in any entry`);
      }
    }
    proofs.push('value search');
  } else {
    lines.push('value search: not run, this run has no secret (as on a Dependabot PR)');
  }

  if (proofs.length === 0) {
    return {
      ok: false,
      lines: [...lines, 'neither proof ran: this run has no secret and no BuildConfig was given'],
    };
  }
  lines.push(`proofs run: ${proofs.join(', ')}`);
  return { ok, lines };
}

/**
 * Reads the folders and BuildConfig the environment names, runs `check` on
 * each folder, writes every line, and returns the exit code.
 */
function main({ env, readdir, readFile, write }) {
  const dirs = String(env.APK_DIRS ?? '')
    .split('\n')
    .map((d) => d.trim())
    .filter(Boolean);
  if (dirs.length === 0) {
    write('no folder to check was given (APK_DIRS is empty)\n');
    return 1;
  }
  let buildConfig = null;
  if (env.BUILD_CONFIG) {
    try {
      buildConfig = {
        path: env.BUILD_CONFIG,
        text: readFile(env.BUILD_CONFIG).toString('utf8'),
        expected: env.EXPECTED_FIELD ?? '',
      };
    } catch (err) {
      write(`${env.BUILD_CONFIG}: cannot be read: ${err.message}\n`);
      return 1;
    }
  }
  let code = 0;
  for (const dir of dirs) {
    let names;
    try {
      names = readdir(dir)
        .filter((n) => APP_FILE.test(n))
        .sort();
    } catch (err) {
      write(`${dir}: cannot be listed: ${err.message}\n`);
      code = 1;
      continue;
    }
    const apps = names.map((n) => ({ path: `${dir}/${n}`, bytes: readFile(`${dir}/${n}`) }));
    const { ok, lines } = check({ dir, apps, secret: env.PERSONA_PASSWORD ?? '', buildConfig });
    write(lines.map((l) => `${l}\n`).join(''));
    if (!ok) code = 1;
  }
  return code;
}

module.exports = { readZipEntries, holdsSecret, buildConfigField, zipOf, check, main };

if (require.main === module) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  process.exitCode = main({
    env: process.env,
    readdir: (dir) => fs.readdirSync(dir),
    readFile: (p) => fs.readFileSync(p),
    write: (text) => {
      process.stdout.write(text);
      if (summary) fs.appendFileSync(summary, text);
    },
  });
}
