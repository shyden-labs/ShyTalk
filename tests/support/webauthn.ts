/**
 * A software authenticator for the passkey tests (plan 7 Task 5,
 * shyden-labs/ShyTalk#134): it answers WebAuthn registration and sign-in
 * challenges as a phone would, with an ES256 key, "none" attestation and the
 * user-verified flag set (the phone's Face ID or fingerprint). Real phones do
 * this in the phone runs; here it is WebCrypto, so the server's own
 * verification (`@simplewebauthn/server`, inside Better Auth's passkey plugin)
 * checks every answer for real.
 */

const encoder = new TextEncoder();

export const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));

/** The CBOR head of major type `major` with `value` (RFC 8949 §3). */
function head(major: number, value: number): Uint8Array {
  if (value < 24) return new Uint8Array([(major << 5) | value]);
  if (value < 256) return new Uint8Array([(major << 5) | 24, value]);
  return new Uint8Array([(major << 5) | 25, value >> 8, value & 255]);
}

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

/** Just enough CBOR for attestation objects and COSE keys. */
export function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') {
    const bytes = encoder.encode(value);
    return concat(head(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  return concat(head(5, value.size), ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]));
}

/** An ECDSA signature as WebCrypto gives it (r‖s) in the DER form WebAuthn carries. */
function der(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array): Uint8Array => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.slice(start);
    const padded = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, padded.length]), padded);
  };
  const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

/** Flags: user present (0x01), user verified (0x04), attested credential data (0x40). */
const UP = 0x01;
const UV = 0x04;
const AT = 0x40;

/** What a browser's `credential.toJSON()` gives after a registration (RegistrationResponseJSON). */
export interface RegistrationAnswer {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: 'platform';
  response: { clientDataJSON: string; attestationObject: string; transports: 'internal'[] };
}

/** What a browser's `credential.toJSON()` gives after a sign-in (AuthenticationResponseJSON). */
export interface SignInAnswer {
  id: string;
  rawId: string;
  type: 'public-key';
  clientExtensionResults: Record<string, never>;
  authenticatorAttachment: 'platform';
  response: { clientDataJSON: string; authenticatorData: string; signature: string };
}

export interface SoftCredential {
  id: Uint8Array;
  privateKey: CryptoKey;
  counter: number;
}

interface Ceremony {
  rpId: string;
  origin: string;
  /** The challenge from the server's options, base64url, as it sent it. */
  challenge: string;
}

const clientData = (type: string, { origin, challenge }: Ceremony): Uint8Array =>
  encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

/** Answers a registration challenge: a new credential and the RegistrationResponseJSON for it. */
export async function register(ceremony: Ceremony): Promise<{ credential: SoftCredential; response: RegistrationAnswer }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const fromB64url = (text: string | undefined): Uint8Array =>
    Uint8Array.from(atob((text ?? '').replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
  const coseKey = cbor(
    new Map<number, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, fromB64url(jwk.x)],
      [-3, fromB64url(jwk.y)],
    ]),
  );
  const id = crypto.getRandomValues(new Uint8Array(16));
  const authData = concat(
    await sha256(encoder.encode(ceremony.rpId)),
    new Uint8Array([UP | UV | AT]),
    new Uint8Array([0, 0, 0, 0]),
    new Uint8Array(16),
    new Uint8Array([0, id.length]),
    id,
    coseKey,
  );
  const attestationObject = cbor(
    new Map<string, Cbor>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]),
  );
  return {
    credential: { id, privateKey: pair.privateKey, counter: 0 },
    response: {
      id: base64url(id),
      rawId: base64url(id),
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: base64url(clientData('webauthn.create', ceremony)),
        attestationObject: base64url(attestationObject),
        transports: ['internal'],
      },
    },
  };
}

/** Answers a sign-in challenge with `credential`: the AuthenticationResponseJSON. */
export async function assert(credential: SoftCredential, ceremony: Ceremony): Promise<SignInAnswer> {
  credential.counter += 1;
  const count = credential.counter;
  const authData = concat(
    await sha256(encoder.encode(ceremony.rpId)),
    new Uint8Array([UP | UV]),
    new Uint8Array([(count >>> 24) & 255, (count >>> 16) & 255, (count >>> 8) & 255, count & 255]),
  );
  const data = clientData('webauthn.get', ceremony);
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      credential.privateKey,
      concat(authData, await sha256(data)) as Uint8Array<ArrayBuffer>,
    ),
  );
  return {
    id: base64url(credential.id),
    rawId: base64url(credential.id),
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: base64url(data),
      authenticatorData: base64url(authData),
      signature: base64url(der(signed)),
    },
  };
}
