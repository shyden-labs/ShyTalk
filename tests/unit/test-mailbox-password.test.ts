import { afterEach, describe, it, expect, vi } from 'vitest';
import { envMailboxPassword } from '../phones/test-mailbox.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the test mailbox password a run was given', () => {
  it('is TEST_MAILBOX_PASSWORD, as the phone run set it from the Keychain', () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', 'from-the-keychain');
    expect(envMailboxPassword()).toBe('from-the-keychain');
  });

  it('is empty when the run set none, for the mailbox to refuse naming the variable', () => {
    vi.stubEnv('TEST_MAILBOX_PASSWORD', undefined);
    expect(envMailboxPassword()).toBe('');
  });
});
