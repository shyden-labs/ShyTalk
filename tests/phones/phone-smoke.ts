/**
 * Runs the smoke suite on both USB phones against one deployed address
 * (shyden-labs/ShyTalk#112; docs/supported-targets.md):
 *
 *   npm run test:phones -- <https address of TEST or DEV>
 */
import { realDeps } from './devices.ts';
import { runPhones } from './run.ts';

process.exitCode = await runPhones(process.argv[2] ?? '', realDeps());
