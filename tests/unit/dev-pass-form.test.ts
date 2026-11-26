import { describe, expect, it } from 'vitest';
import { MAX_FORM_BYTES, readForm } from '../../workers/door/src/dev-pass/form.ts';

/**
 * Reading a form at a public door (shyden-labs/repo-template#211): a body with
 * no Content-Length is counted while it streams in and cancelled the moment it
 * passes 4 KiB, so an unauthenticated chunked POST is never held whole.
 */

const KIB = 1_024;
const FORM_TYPE = { 'content-type': 'application/x-www-form-urlencoded' };

/** A POST whose body streams `chunks` chunks of 1 KiB of `a`, recording how much was pulled and whether it was cancelled. */
function streamedPost(chunks: number) {
  const seen = { pulledBytes: 0, cancelled: false };
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      sent += 1;
      seen.pulledBytes += KIB;
      controller.enqueue(new Uint8Array(KIB).fill(0x61));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  const request = new Request('https://dev.example.com/__devpass/accept', { method: 'POST', headers: FORM_TYPE, body, duplex: 'half' });
  return { request, seen };
}

describe('readForm with a body of no declared length', () => {
  it('refuses more than 4 KiB with 413, pulling at most one chunk past the cap, and cancels the stream', async () => {
    const { request, seen } = streamedPost(64);
    expect(request.headers.get('content-length')).toBeNull();

    expect(await readForm(request)).toBe(413);
    expect(seen.pulledBytes).toBeLessThanOrEqual(MAX_FORM_BYTES + KIB);
    expect(seen.cancelled).toBe(true);
  });

  it('decodes exactly 4 KiB streamed in chunks into the form', async () => {
    const { request, seen } = streamedPost(MAX_FORM_BYTES / KIB);

    const form = await readForm(request);
    expect(form).toBeInstanceOf(URLSearchParams);
    expect([...(form as URLSearchParams).keys()]).toEqual(['a'.repeat(MAX_FORM_BYTES)]);
    expect(seen.cancelled).toBe(false);
  });

  // A Worker types a request's body as a stream of any (shyden-labs/repo-template#221): a chunk that is not bytes is refused, the stream cancelled.
  it('refuses a body whose chunks are not bytes, and cancels the stream', async () => {
    let cancelled = false;
    const body = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue('a=b');
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = { headers: new Headers(FORM_TYPE), body } as unknown as Request;

    await expect(readForm(request)).rejects.toThrow(new TypeError('a form body chunk is not bytes'));
    expect(cancelled).toBe(true);
  });

  it('reads a POST with no body as an empty form', async () => {
    const request = new Request('https://dev.example.com/__devpass/accept', { method: 'POST', headers: FORM_TYPE });
    expect(request.body).toBeNull();

    const form = await readForm(request);
    expect(form).toBeInstanceOf(URLSearchParams);
    expect([...(form as URLSearchParams).keys()]).toEqual([]);
  });
});
