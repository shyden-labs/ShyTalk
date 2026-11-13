/**
 * A Playwright reporter counting the assertions that ran (shyden-labs/ShyTalk#180):
 * from the runner's own step events, every `expect` step per target and test,
 * written as JSON `{ target: { test title: count } }`. The tries an
 * `expect.poll` or `toPass` makes are steps nested inside its own `expect`
 * step, and are not counted, so each target counts the same for the same test.
 * `scripts/smoke-totals.ts` compares the counts across targets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The part of Playwright's TestStep this reads. */
export interface CountedStep {
  category: string;
  parent?: CountedStep;
}

/** The part of Playwright's TestCase this reads. */
export interface CountedTest {
  title: string;
  parent: { project(): { name: string } | undefined };
}

export interface AssertionCountsOptions {
  outputFile: string;
  write?: (path: string, text: string) => void;
}

function writeFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const insideExpect = (step: CountedStep): boolean =>
  step.parent !== undefined && (step.parent.category === 'expect' || insideExpect(step.parent));

export default class AssertionCounts {
  private readonly counts: Record<string, Record<string, number>> = {};
  private readonly outputFile: string;
  private readonly write: (path: string, text: string) => void;

  constructor({ outputFile, write = writeFile }: AssertionCountsOptions) {
    this.outputFile = outputFile;
    this.write = write;
  }

  onStepEnd(test: CountedTest, _result: unknown, step: CountedStep): void {
    if (step.category !== 'expect' || insideExpect(step)) return;
    const target = test.parent.project()?.name ?? '';
    const mine = (this.counts[target] ??= {});
    mine[test.title] = (mine[test.title] ?? 0) + 1;
  }

  onEnd(): void {
    this.write(this.outputFile, JSON.stringify(this.counts, null, 2));
  }
}
