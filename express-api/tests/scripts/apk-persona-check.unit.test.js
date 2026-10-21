'use strict';

/**
 * apk-persona-check.unit.test.js — SHY-0662.
 *
 * `scripts/ci/apk-persona-check.js` is the CI step that proves a built APK or
 * AAB does not hold the dev persona password. It runs two proofs (Shyden,
 * 2026-10-21): the build's own BuildConfig field is the flavour's expected
 * value, which needs no secret; and, wherever the run has the secret, a
 * search of every inflated entry for it, after a planted APK proves the
 * search can see it. Loaded in-process: no unzip, no child process; every
 * planted APK is a zip built here.
 */

const zlib = require('zlib');
const {
  readZipEntries,
  holdsSecret,
  buildConfigField,
  zipOf,
  check,
  main,
} = require('../../../scripts/ci/apk-persona-check.js');

const SECRET = 'plant-9c4e1f-persona';
const FIELD = 'DEV_QA_PERSONAS_PASSWORD';
const configText = (value) =>
  `package com.shyden.shytalk;\npublic final class BuildConfig {\n  public static final String ${FIELD} = ${JSON.stringify(value)};\n}\n`;
const clean = () =>
  zipOf([
    { name: 'AndroidManifest.xml', data: Buffer.from('<manifest/>') },
    { name: 'classes.dex', data: Buffer.from('dex\n035 nothing to see') },
  ]);
const app = (bytes, path = 'app/build/outputs/apk/dev/release/app-dev-release.apk') => ({
  path,
  bytes,
});

describe('readZipEntries', () => {
  test('reads a deflated entry back to its bytes', () => {
    const entries = readZipEntries(
      zipOf([{ name: 'classes.dex', data: Buffer.from('hello dex') }]),
    );
    expect(entries.map((e) => [e.name, e.data.toString()])).toEqual([['classes.dex', 'hello dex']]);
  });

  test('reads a stored entry back to its bytes', () => {
    const entries = readZipEntries(
      zipOf([{ name: 'resources.arsc', data: Buffer.from('arsc'), method: 0 }]),
    );
    expect(entries.map((e) => [e.name, e.data.toString()])).toEqual([['resources.arsc', 'arsc']]);
  });

  test('reads every entry, in order', () => {
    const entries = readZipEntries(clean());
    expect(entries.map((e) => e.name)).toEqual(['AndroidManifest.xml', 'classes.dex']);
  });

  test('reads entries when a signing block sits before the central directory', () => {
    const entries = readZipEntries(
      zipOf([{ name: 'classes.dex', data: Buffer.from('dex') }], { gap: 4096 }),
    );
    expect(entries.map((e) => e.data.toString())).toEqual(['dex']);
  });

  test('refuses bytes with no end of central directory', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all, just text'))).toThrow(
      'no end of central directory record',
    );
  });

  test('refuses a zip64 archive it does not read', () => {
    const zip = clean();
    zip.writeUInt32LE(0xffffffff, zip.length - 6);
    expect(() => readZipEntries(zip)).toThrow('zip64 archives are not read');
  });

  test('refuses an entry compressed by a method it does not read', () => {
    const zip = zipOf([{ name: 'classes.dex', data: Buffer.from('dex'), method: 12 }]);
    expect(() => readZipEntries(zip)).toThrow('classes.dex: compression method 12 is not read');
  });

  test('refuses an entry whose data runs past the end', () => {
    const zip = zipOf([
      { name: 'classes.dex', data: Buffer.from('dex'), method: 0, claimSize: 999 },
    ]);
    expect(() => readZipEntries(zip)).toThrow('classes.dex: data runs past the end of the file');
  });

  test('refuses an entry that inflates to another size than recorded', () => {
    const zip = zipOf([{ name: 'classes.dex', data: Buffer.from('dex'), claimUncompressed: 7 }]);
    expect(() => readZipEntries(zip)).toThrow('classes.dex: inflated to 3 bytes, recorded 7');
  });
});

describe('holdsSecret', () => {
  test('finds the secret as UTF-8 bytes', () => {
    expect(holdsSecret(Buffer.from(`xx${SECRET}yy`), SECRET)).toBe(true);
  });

  test('finds the secret as UTF-16LE bytes', () => {
    expect(
      holdsSecret(Buffer.concat([Buffer.from('xx'), Buffer.from(SECRET, 'utf16le')]), SECRET),
    ).toBe(true);
  });

  test('does not find a secret that is absent', () => {
    expect(holdsSecret(Buffer.from('plant-9c4e1f-persoNA'), SECRET)).toBe(false);
  });

  test('refuses an empty secret, which every file holds', () => {
    expect(() => holdsSecret(Buffer.from('x'), '')).toThrow('the secret to search for is empty');
  });
});

describe('buildConfigField', () => {
  test('reads an empty value', () => {
    expect(buildConfigField(configText(''), FIELD)).toBe('');
  });

  test('reads a value', () => {
    expect(buildConfigField(configText('localdev123'), FIELD)).toBe('localdev123');
  });

  test('reads a value holding an escaped quote', () => {
    expect(buildConfigField(configText('a"b'), FIELD)).toBe('a"b');
  });

  test('refuses a BuildConfig without the field', () => {
    expect(() => buildConfigField('public final class BuildConfig {}', FIELD)).toThrow(
      `BuildConfig declares ${FIELD} 0 times, not once`,
    );
  });

  test('refuses a BuildConfig declaring the field twice', () => {
    expect(() => buildConfigField(configText('') + configText(''), FIELD)).toThrow(
      `BuildConfig declares ${FIELD} 2 times, not once`,
    );
  });
});

describe('check', () => {
  const config = (value, expected = '') => ({
    path: 'BuildConfig.java',
    text: configText(value),
    expected,
  });

  test('passes a clean APK, naming the file, its size, entries and inflated bytes', () => {
    const bytes = clean();
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(bytes)],
      secret: SECRET,
      buildConfig: config(''),
    });
    expect({ ok, lines }).toEqual({
      ok: true,
      lines: [
        `app/build/outputs/apk/dev/release/app-dev-release.apk: ${bytes.length} bytes, 2 entries, 33 bytes inflated`,
        `BuildConfig.java: ${FIELD} is the flavour's expected value`,
        'planted APK: the search finds the secret, so it can see it',
        'app/build/outputs/apk/dev/release/app-dev-release.apk: the secret is not in any entry',
        'proofs run: BuildConfig field, value search',
      ],
    });
  });

  test('refuses a planted APK holding the secret in classes.dex', () => {
    const bad = zipOf([{ name: 'classes.dex', data: Buffer.from(`dex ${SECRET} dex`) }]);
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(bad)],
      secret: SECRET,
      buildConfig: config(''),
    });
    expect({ ok, found: lines.filter((l) => l.includes('HOLDS the secret')) }).toEqual({
      ok: false,
      found: [
        'app/build/outputs/apk/dev/release/app-dev-release.apk: HOLDS the secret in classes.dex',
      ],
    });
  });

  test('refuses a planted APK holding the secret as UTF-16 in resources.arsc', () => {
    const bad = zipOf([
      { name: 'resources.arsc', data: Buffer.from(SECRET, 'utf16le'), method: 0 },
    ]);
    expect(check({ dir: 'd', apps: [app(bad)], secret: SECRET, buildConfig: null }).ok).toBe(false);
  });

  test('never prints the secret, even when it finds it', () => {
    const bad = zipOf([{ name: 'classes.dex', data: Buffer.from(SECRET) }]);
    const { lines } = check({
      dir: 'd',
      apps: [app(bad)],
      secret: SECRET,
      buildConfig: config(SECRET),
    });
    expect({ lines: lines.length > 0, printed: lines.filter((l) => l.includes(SECRET)) }).toEqual({
      lines: true,
      printed: [],
    });
  });

  test('refuses a folder holding no APK or AAB', () => {
    expect(check({ dir: 'dev-release-apk', apps: [], secret: SECRET, buildConfig: null })).toEqual({
      ok: false,
      lines: ['dev-release-apk: no .apk or .aab file to read'],
    });
  });

  test('refuses an APK with no entries', () => {
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(zipOf([]))],
      secret: SECRET,
      buildConfig: null,
    });
    expect({ ok, last: lines.at(-1) }).toEqual({
      ok: false,
      last: 'app/build/outputs/apk/dev/release/app-dev-release.apk: read 0 entries and 0 bytes, so nothing was searched',
    });
  });

  test('refuses an APK it cannot read', () => {
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(Buffer.from('junk'))],
      secret: SECRET,
      buildConfig: null,
    });
    expect({ ok, lines }).toEqual({
      ok: false,
      lines: [
        'app/build/outputs/apk/dev/release/app-dev-release.apk: cannot be read: no end of central directory record',
      ],
    });
  });

  test('with no secret, passes on the BuildConfig proof alone and says the search did not run', () => {
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(clean())],
      secret: '',
      buildConfig: config(''),
    });
    expect({ ok, tail: lines.slice(1) }).toEqual({
      ok: true,
      tail: [
        `BuildConfig.java: ${FIELD} is the flavour's expected value`,
        'value search: not run, this run has no secret (as on a Dependabot PR)',
        'proofs run: BuildConfig field',
      ],
    });
  });

  test('with no secret and no BuildConfig, refuses: neither proof can run', () => {
    const { ok, lines } = check({ dir: 'd', apps: [app(clean())], secret: '', buildConfig: null });
    expect({ ok, last: lines.at(-1) }).toEqual({
      ok: false,
      last: 'neither proof ran: this run has no secret and no BuildConfig was given',
    });
  });

  test('refuses a BuildConfig field that is not the expected value, without printing it', () => {
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(clean())],
      secret: '',
      buildConfig: config('leaked-1'),
    });
    expect({ ok, line: lines[1] }).toEqual({
      ok: false,
      line: `BuildConfig.java: ${FIELD} is NOT the flavour's expected value (it holds 8 characters)`,
    });
  });

  test("passes the local flavour's hard-coded emulator value when that is what it expects", () => {
    const { ok } = check({
      dir: 'd',
      apps: [app(clean())],
      secret: '',
      buildConfig: config('localdev123', 'localdev123'),
    });
    expect(ok).toBe(true);
  });

  test('refuses a BuildConfig it cannot read', () => {
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(clean())],
      secret: '',
      buildConfig: { path: 'BuildConfig.java', text: 'class BuildConfig {}', expected: '' },
    });
    expect({ ok, line: lines[1] }).toEqual({
      ok: false,
      line: `BuildConfig.java: cannot be read: BuildConfig declares ${FIELD} 0 times, not once`,
    });
  });

  test('refuses when the planted APK shows the search cannot see the secret', () => {
    const blind = () => false;
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(clean())],
      secret: SECRET,
      buildConfig: null,
      search: blind,
    });
    expect({ ok, line: lines[1] }).toEqual({
      ok: false,
      line: 'planted APK: the search did NOT find the secret, so it cannot be trusted',
    });
  });

  test('reads every APK in the folder', () => {
    const bad = zipOf([{ name: 'classes2.dex', data: Buffer.from(SECRET) }]);
    const { ok, lines } = check({
      dir: 'd',
      apps: [app(clean(), 'a.apk'), app(bad, 'b.aab')],
      secret: SECRET,
      buildConfig: null,
    });
    expect({ ok, found: lines.filter((l) => l.includes('the secret')) }).toEqual({
      ok: false,
      found: [
        'planted APK: the search finds the secret, so it can see it',
        'a.apk: the secret is not in any entry',
        'b.aab: HOLDS the secret in classes2.dex',
      ],
    });
  });
});

describe('main', () => {
  const run = ({ env, files }) => {
    const written = [];
    const code = main({
      env,
      readdir: (dir) => {
        if (!(dir in files)) throw new Error(`ENOENT: ${dir}`);
        return Object.keys(files[dir]);
      },
      readFile: (p) => {
        const [dir, name] = [p.slice(0, p.lastIndexOf('/')), p.slice(p.lastIndexOf('/') + 1)];
        if (!files[dir] || !(name in files[dir])) throw new Error(`ENOENT: ${p}`);
        return files[dir][name];
      },
      write: (text) => written.push(text),
    });
    return { code, out: written.join('') };
  };

  test('reads only the .apk and .aab files of each folder it is given', () => {
    const { code, out } = run({
      env: { APK_DIRS: 'out/a\nout/b\n', PERSONA_PASSWORD: SECRET },
      files: {
        'out/a': { 'x.apk': clean(), 'output-metadata.json': Buffer.from('{}') },
        'out/b': { 'y.aab': clean() },
      },
    });
    expect({
      code,
      read: out
        .split('\n')
        .filter((l) => / bytes, \d+ entries/.test(l))
        .map((l) => l.split(':')[0]),
    }).toEqual({
      code: 0,
      read: ['out/a/x.apk', 'out/b/y.aab'],
    });
  });

  test('exits 1 when a folder holds an APK with the secret', () => {
    const bad = zipOf([{ name: 'classes.dex', data: Buffer.from(SECRET) }]);
    expect(
      run({
        env: { APK_DIRS: 'out/a', PERSONA_PASSWORD: SECRET },
        files: { 'out/a': { 'x.apk': bad } },
      }).code,
    ).toBe(1);
  });

  test('exits 1 when a folder it is given is missing', () => {
    const { code, out } = run({
      env: { APK_DIRS: 'out/none', PERSONA_PASSWORD: SECRET },
      files: {},
    });
    expect({ code, out: out.includes('out/none: cannot be listed: ENOENT: out/none') }).toEqual({
      code: 1,
      out: true,
    });
  });

  test('exits 1 when no folder is given', () => {
    expect(run({ env: { APK_DIRS: '  \n', PERSONA_PASSWORD: SECRET }, files: {} })).toEqual({
      code: 1,
      out: 'no folder to check was given (APK_DIRS is empty)\n',
    });
  });

  test('exits 1 when the BuildConfig it is given is missing', () => {
    const { code, out } = run({
      env: { APK_DIRS: 'out/a', PERSONA_PASSWORD: '', BUILD_CONFIG: 'gen/BuildConfig.java' },
      files: { 'out/a': { 'x.apk': clean() } },
    });
    expect({
      code,
      out: out.includes('gen/BuildConfig.java: cannot be read: ENOENT: gen/BuildConfig.java'),
    }).toEqual({
      code: 1,
      out: true,
    });
  });

  test('passes on the BuildConfig proof with no secret, reading the expected value it is given', () => {
    const { code } = run({
      env: {
        APK_DIRS: 'out/a',
        PERSONA_PASSWORD: '',
        BUILD_CONFIG: 'gen/BuildConfig.java',
        EXPECTED_FIELD: 'localdev123',
      },
      files: {
        'out/a': { 'x.apk': clean() },
        gen: { 'BuildConfig.java': Buffer.from(configText('localdev123')) },
      },
    });
    expect(code).toBe(0);
  });
});

describe('zipOf', () => {
  test('deflates by default, so a raw search of the zip cannot see the data', () => {
    const data = Buffer.from(`${SECRET} `.repeat(20));
    const zip = zipOf([{ name: 'classes.dex', data }]);
    expect({
      raw: zip.includes(Buffer.from(SECRET)),
      inflated: zlib.inflateRawSync(zlib.deflateRawSync(data)).equals(data),
    }).toEqual({
      raw: false,
      inflated: true,
    });
  });
});
