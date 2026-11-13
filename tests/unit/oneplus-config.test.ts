/**
 * The OnePlus phone config's per-test limit (shyden-labs/ShyTalk#185): real
 * mail took 48 s on 2026-11-13, so each test gets 180 s (Shyden's choice),
 * above the mail reader's own ceiling.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAIL_CEILING_MS } from '../phones/test-mailbox.ts';

describe('the OnePlus phone config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('gives each test 180 s, more than the mail reader waits for a mail', async () => {
    vi.stubEnv('PHONE_BASE_URL', 'https://phone.example.test');
    vi.stubEnv('SMOKE_CDP_ENDPOINT', 'http://127.0.0.1:9');

    // A computed specifier: the config is loaded for real, but the root type check never pulls in
    // Playwright's DOM-typed declarations (tests/smoke has its own tsconfig with the DOM lib).
    const configUrl = new URL('../smoke/oneplus.config.ts', import.meta.url).href;
    const { default: config } = (await import(/* @vite-ignore */ configUrl)) as { default: { timeout?: number } };

    expect(config.timeout).toBe(180_000);
    expect(MAIL_CEILING_MS).toBe(120_000);
    expect(config.timeout).toBeGreaterThan(MAIL_CEILING_MS);
  });
});
