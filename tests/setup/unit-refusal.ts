import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { expect } from 'vitest';
import { installRefusals, testName } from './refusals.ts';

installRefusals({ childProcess, net, tls, dgram, dns, globals: globalThis }, () => testName(expect.getState()));
// A named or namespace import of a built-in reads Node's ESM copy of its
// exports; this brings that copy in line with the refusals.
syncBuiltinESMExports();
