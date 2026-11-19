import { afterEach, describe, it, expect, vi } from 'vitest';

// The entry script runs the phone run with the real steps; both are stood in, so nothing reaches a phone.
const deps = { stood: 'in' };
vi.mock('../phones/devices.ts', () => ({ realDeps: () => deps }));
vi.mock('../phones/run.ts', () => ({ runPhones: vi.fn() }));
const { runPhones } = await import('../phones/run.ts');

const argv = process.argv;

/** Runs the entry script afresh with `args` after the node and script paths, and returns the exit code it set. */
async function entry(args: string[], code: number): Promise<number | string | null | undefined> {
  vi.mocked(runPhones).mockResolvedValue(code);
  process.argv = [...argv.slice(0, 2), ...args];
  vi.resetModules();
  await import('../phones/phone-smoke.ts');
  const set = process.exitCode;
  process.exitCode = undefined;
  return set;
}

afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
});

describe('the phone run entry script', () => {
  it('runs both phones against the address given, with the real steps, and exits with the run’s code', async () => {
    expect(await entry(['https://phones.example'], 3)).toBe(3);
    expect(vi.mocked(runPhones).mock.calls).toEqual([['https://phones.example', deps]]);
  });

  it('passes an empty address when none is given, for the run to refuse', async () => {
    expect(await entry([], 0)).toBe(0);
    expect(vi.mocked(runPhones).mock.calls).toEqual([['', deps]]);
  });
});
