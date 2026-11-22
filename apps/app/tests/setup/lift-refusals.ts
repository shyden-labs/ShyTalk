import { afterAll } from '@jest/globals';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { restoreRefusals } from '../../../../tests/setup/refusals.ts';

// Jest runs a few fast files inside its own process, where Node's modules are
// Jest's too: the refusals tests/setup/unit-refusal.ts installed are lifted as
// each file ends, so Jest's own coverage workers can start (plan 6.1 Task 1).
afterAll(() => {
  restoreRefusals({ childProcess, net, tls, dgram, dns, globals: globalThis });
  syncBuiltinESMExports();
});
