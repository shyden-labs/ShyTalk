import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import type { expect as jestExpect } from '@jest/globals';
import { installRefusals, testName } from '../../../../tests/setup/refusals.ts';

// Jest runs setup files before it defines `expect`, so the test's name is read from the global when a refusal fires.
installRefusals({ childProcess, net, tls, dgram, dns, globals: globalThis }, () =>
  testName((globalThis as unknown as { expect: typeof jestExpect }).expect.getState()),
);
// A named or namespace import of a built-in reads Node's ESM copy of its
// exports; this brings that copy in line with the refusals.
syncBuiltinESMExports();
