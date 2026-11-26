// Copied unchanged from shyden-labs/repo-template scripts/dev-pass/form.ts at 449e1c612e9671a0eaaffee33dd4330fe0f306e3 (shyden-labs/repo-template#207,
// adopted by shyden-labs/ShyTalk#314). Change it there first, then copy it again.
// Reading a small urlencoded form at a public door (shyden-labs/repo-template#207):
// no multipart parsing, and a body over 4 KiB is never decoded. A body of no
// declared length is counted as it streams in and cancelled once it passes the
// cap, so it is never held whole (shyden-labs/repo-template#211).

export const MAX_FORM_BYTES = 4_096;

/** The form, or the status to refuse it with: 415 for another type, 413 for a body over 4 KiB. */
export async function readForm(request: Request): Promise<URLSearchParams | 413 | 415> {
  if (!/^\s*application\/x-www-form-urlencoded\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return 415;
  // A declared length is refused before reading.
  if (Number(request.headers.get('content-length')) > MAX_FORM_BYTES) return 413;
  const bytes = request.body === null ? new Uint8Array(0) : await readUpToCap(request.body);
  if (bytes === 413) return 413;
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

/** The stream's bytes, or 413 with the stream cancelled as soon as they pass `MAX_FORM_BYTES`. */
async function readUpToCap(body: ReadableStream<unknown>): Promise<Uint8Array | 413> {
  const bytes = new Uint8Array(MAX_FORM_BYTES);
  const length = await readChunks(body.getReader(), bytes, 0);
  return length === null ? 413 : bytes.subarray(0, length);
}

/**
 * Reads one chunk at a time into `bytes` from `length` on, and returns the total, or null (the
 * stream cancelled) once the next chunk would pass the cap. One read per call, never awaited in a
 * loop (SonarCloud S9382); a `for await` was tried and pulls one chunk ahead, past the one-chunk bound.
 */
async function readChunks(reader: ReadableStreamDefaultReader<unknown>, bytes: Uint8Array, length: number): Promise<number | null> {
  const chunk = await reader.read();
  if (chunk.done) return length;
  // A Worker types the body as a stream of any (shyden-labs/repo-template#221); the Fetch standard sends bytes.
  if (!(chunk.value instanceof Uint8Array)) {
    await reader.cancel();
    throw new TypeError('a form body chunk is not bytes');
  }
  if (length + chunk.value.byteLength > MAX_FORM_BYTES) {
    await reader.cancel();
    return null;
  }
  bytes.set(chunk.value, length);
  return readChunks(reader, bytes, length + chunk.value.byteLength);
}
