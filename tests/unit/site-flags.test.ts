import { describe, it, expect } from 'vitest';
import { SHOW_ROADMAP, SHOW_SIGN_IN, SUPPORT_EMAIL } from '../../apps/web/src/site.ts';

/**
 * The menu's hidden items and the footer's address (shyden-labs/ShyTalk#51 AC3):
 * the roadmap (shyden-labs/ShyTalk#38) and sign-in (release 3b) stay hidden
 * until their releases turn them on.
 */
describe('the site flags', () => {
  it('hides the roadmap', () => {
    expect(SHOW_ROADMAP).toBe(false);
  });

  it('hides sign-in', () => {
    expect(SHOW_SIGN_IN).toBe(false);
  });

  it('gives support@shytalk.app as the contact', () => {
    expect(SUPPORT_EMAIL).toBe('support@shytalk.app');
  });
});
