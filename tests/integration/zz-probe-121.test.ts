import { describe, it, expect } from 'vitest';

/**
 * Throwaway probe for shyden-labs/ShyTalk#121 AC 3: this test fails on purpose so the
 * pull request carrying it shows whether a red integration job blocks a merge.
 * The pull request is closed unmerged and its branch deleted.
 */
describe('the #121 probe', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2);
  });
});
