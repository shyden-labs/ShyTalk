// Copied unchanged from shyden-labs/repo-template scripts/dev-pass/pass.ts at 449e1c612e9671a0eaaffee33dd4330fe0f306e3 (shyden-labs/repo-template#207,
// adopted by shyden-labs/ShyTalk#314). Change it there first, then copy it again.
// The DEV pass (shyden-labs/repo-template#207): a short-lived, signed ticket that
// opens one product's `dev.` door. `v1.<kid>.<payload>.<sig>`, each part base64url
// without padding; `sig` is Ed25519 over the ASCII bytes `v1.<kid>.<payload>`.
// Pure WebCrypto, so the same file runs in a Cloudflare Worker and in Node.
// The type import is erased: it only names WebCrypto's types, as the template has no DOM lib.

export type PassKind = 'browser' | 'app' | 'machine' | 'embed';
/** A door's keys: `kid` → the Ed25519 public key's JWK `x`. Public, so plain vars, not secrets. */
export type PublicKeys = Readonly<Record<string, string>>;
export interface SigningKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
}
export interface PassClaims {
  /** The one door this pass opens, e.g. `dev.yaweloidle.com`. */
  readonly aud: string;
  /** A person's email or a service token's name. */
  readonly sub: string;
  readonly kind: PassKind;
}
export type PassFailure =
  'missing' | 'malformed' | 'unknown-kid' | 'bad-signature' | 'wrong-audience' | 'expired' | 'not-yet-valid' | 'bad-kind';
export type PassCheck =
  | { readonly ok: true; readonly sub: string; readonly kind: PassKind; readonly exp: number }
  | { readonly ok: false; readonly reason: PassFailure };

/** An embed pass sits where page code can read it, so it lasts minutes (shyden-labs/repo-template#209). */
export const LIFETIME_SECONDS: Readonly<Record<PassKind, number>> = { browser: 12 * 3_600, app: 12 * 3_600, machine: 3_600, embed: 300 };
/** Allowed on `iat` only; `exp` gets none. */
export const CLOCK_SKEW_SECONDS = 60;

const VERSION = 'v1';
const encoder = new TextEncoder();

export function toBase64url(bytes: Uint8Array): string {
  return withoutPadding(
    btoa(String.fromCodePoint(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_'),
  );
}

/** The text without its trailing `=` padding, cut without a backtracking regex (SonarCloud S8786). */
function withoutPadding(base64: string): string {
  let end = base64.length;
  while (end > 0 && base64[end - 1] === '=') end -= 1;
  return base64.slice(0, end);
}

/** Throws on anything that is not base64. */
export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) as number);
}

export async function mintPass(claims: PassClaims, key: SigningKey, now: number): Promise<string> {
  const payload = { aud: claims.aud, sub: claims.sub, kind: claims.kind, iat: now, exp: now + LIFETIME_SECONDS[claims.kind] };
  const head = `${VERSION}.${key.kid}.${toBase64url(encoder.encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign('Ed25519', key.privateKey, encoder.encode(head));
  return `${head}.${toBase64url(new Uint8Array(sig))}`;
}

interface Payload {
  readonly aud: string;
  readonly sub: string;
  readonly kind: string;
  readonly iat: number;
  readonly exp: number;
}

function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return (
    typeof fields['aud'] === 'string' &&
    typeof fields['sub'] === 'string' &&
    fields['sub'] !== '' &&
    typeof fields['kind'] === 'string' &&
    typeof fields['iat'] === 'number' &&
    typeof fields['exp'] === 'number'
  );
}

function decode(pass: string): { kid: string; head: string; payload: Payload; sig: Uint8Array<ArrayBuffer> } | undefined {
  const parts = pass.split('.');
  if (parts.length !== 4) return undefined;
  const [version, kid, body, sig] = parts as [string, string, string, string];
  if (version !== VERSION) return undefined;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    if (!isPayload(payload)) return undefined;
    return { kid, head: `${version}.${kid}.${body}`, payload, sig: fromBase64url(sig) };
  } catch {
    return undefined;
  }
}

const isKind = (kind: string): kind is PassKind => Object.hasOwn(LIFETIME_SECONDS, kind);

export async function verifyPass(pass: string | undefined, options: { host: string; keys: PublicKeys; now: number }): Promise<PassCheck> {
  if (pass === undefined || pass === '') return { ok: false, reason: 'missing' };
  const decoded = decode(pass);
  if (decoded === undefined) return { ok: false, reason: 'malformed' };
  const x = Object.hasOwn(options.keys, decoded.kid) ? options.keys[decoded.kid] : undefined;
  if (x === undefined) return { ok: false, reason: 'unknown-kid' };
  const publicKey = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x }, 'Ed25519', false, ['verify']);
  if (!(await crypto.subtle.verify('Ed25519', publicKey, decoded.sig, encoder.encode(decoded.head))))
    return { ok: false, reason: 'bad-signature' };
  const { aud, sub, kind, iat, exp } = decoded.payload;
  if (aud !== options.host) return { ok: false, reason: 'wrong-audience' };
  if (!isKind(kind)) return { ok: false, reason: 'bad-kind' };
  if (exp <= options.now) return { ok: false, reason: 'expired' };
  if (iat > options.now + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'not-yet-valid' };
  return { ok: true, sub, kind, exp };
}

/** A control character, a space, DEL or a backslash. */
function hasUnsafeChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Where to send someone back to: a path on this host, never another site. `//x` is another
 * site to a browser, and browsers read `\` as `/` and drop tabs and newlines, so a path
 * holding a backslash, a control character or whitespace is refused too.
 */
export function safeBack(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || hasUnsafeChar(value)) return '/';
  return value;
}
