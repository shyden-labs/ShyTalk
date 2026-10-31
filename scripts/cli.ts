/**
 * Runs a script's `main` when that script is the program node started, and
 * does nothing when a test imports it. Every script's entry goes through here,
 * so the started-or-imported branch is tested once, in-process, and each
 * script's own last line always runs (issue shyden-labs/repo-template#32).
 *
 *   await runIfEntry(import.meta.url, main);
 *
 * The call is awaited at the top of the module, so an error thrown by `main`
 * rejects the module and node prints it and exits 1.
 */
import { pathToFileURL } from 'node:url';

export interface Proc {
  argv: string[];
  exit(code: number): void;
}

export async function runIfEntry(
  moduleUrl: string,
  main: (args: string[]) => number | Promise<number>,
  proc: Proc = process,
): Promise<void> {
  const program = proc.argv[1];
  if (program === undefined || moduleUrl !== pathToFileURL(program).href) return;
  // An async main (one that reads over HTTP) is waited for; its rejection is left to node, which prints it and exits 1.
  proc.exit(await main(proc.argv.slice(2)));
}
