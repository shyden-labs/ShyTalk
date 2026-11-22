import { describe, it, expect, vi } from 'vitest';
import { validateUiDocument } from '../../packages/ui-document/index.ts';

// Plan 6.2 adds the first native block; here the catalogue is stood in with
// one, so a screen holding a listed block is shown to pass (plan 6.1 Task 2).
vi.mock('../../packages/ui-document/catalogue.ts', async (original) => ({
  ...(await original<typeof import('../../packages/ui-document/catalogue.ts')>()),
  BLOCKS: ['consentNotice'],
}));

const lines = {
  'nav.home': 'Home',
  'sealed.update.title': 'Update ShyTalk',
  'sealed.update.body': 'This version of ShyTalk is no longer supported. Update it to keep going.',
  'sealed.update.button': 'Update',
};

describe('a native block', () => {
  it('passes when the catalogue lists it', () => {
    const result = validateUiDocument({
      schemaVersion: 2,
      navigation: [{ id: 'home', route: 'home', label: 'nav.home' }],
      tokens: {},
      switches: {},
      copy: { en: lines, id: lines, th: lines, vi: lines, zh: lines },
      screens: { home: { compact: { id: 'root', part: 'column', children: [{ id: 'consent', block: 'consentNotice' }] } } },
    });
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});
