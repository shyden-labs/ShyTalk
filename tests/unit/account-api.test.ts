import { afterEach, describe, expect, it, vi } from 'vitest';
import { call } from '../../apps/web/src/account/api.ts';

/**
 * How the account pages reach the app's API (plan 7 Task 7,
 * shyden-labs/ShyTalk#133, #134): JSON in and out, same-site cookies, and a
 * lost connection read as status 0 so every page shows its failure line.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('call', () => {
  it('posts JSON to the app API and answers the status and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sent: true }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(call('email/start', { email: 'a@example.test' })).resolves.toEqual({ status: 202, body: { sent: true } });
    expect(fetchMock).toHaveBeenCalledWith('/api/app/email/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"email":"a@example.test"}',
    });
  });

  it('sends a GET with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"pending":null}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(call('recovery', undefined, 'GET')).resolves.toEqual({ status: 200, body: { pending: null } });
    expect(fetchMock).toHaveBeenCalledWith('/api/app/recovery', { method: 'GET', credentials: 'same-origin' });
  });

  it('sends a DELETE with no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await call('sessions/s-1', undefined, 'DELETE');
    expect(fetchMock).toHaveBeenCalledWith('/api/app/sessions/s-1', { method: 'DELETE', credentials: 'same-origin' });
  });

  it('answers a body that is not JSON as null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 405 })));
    await expect(call('sign-out', {})).resolves.toEqual({ status: 405, body: null });
  });

  it('answers a lost connection as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(call('sign-out', {})).resolves.toEqual({ status: 0, body: null });
  });
});
