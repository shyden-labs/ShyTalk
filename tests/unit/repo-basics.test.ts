import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * What every repository created from this template inherits (Refs shyden-labs/repo-template#1): an
 * open-source licence naming Shyden Labs.
 */

describe('the licence', () => {
  it('is Apache-2.0', () => {
    expect(readFileSync('LICENSE', 'utf8')).toContain('Apache License\n                           Version 2.0, January 2004');
  });

  it('names Shyden Labs as the copyright holder', () => {
    expect(readFileSync('LICENSE', 'utf8').split('\n')[0]).toBe('Copyright 2026 Shyden Labs');
  });
});
