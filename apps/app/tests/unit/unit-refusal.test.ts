import { test, expect } from '@jest/globals';
import childProcess from 'node:child_process';
import net from 'node:net';

// The app's unit suite keeps the repo's unit rules (shyden-labs/repo-template#92):
// tests/setup/unit-refusal.ts refuses every process and connection here too.
test('the app suite refuses a process', () => {
  expect(() => childProcess.execSync('true')).toThrow('A unit test starts no process.');
});

test('the app suite refuses a connection', () => {
  expect(() => net.connect(80, '127.0.0.1')).toThrow('A unit test opens no connection.');
});
