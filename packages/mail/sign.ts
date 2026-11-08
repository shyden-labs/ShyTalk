/**
 * Oracle Cloud request signatures, version 1 (shyden-labs/ShyTalk#88; Oracle's
 * "Request Signatures" page): a POST signs `(request-target)`, `host`, `date`,
 * `x-content-sha256`, `content-type` and `content-length` with RSA-SHA256.
 * WebCrypto only, so the same code runs in workerd and in Node.
 */

export interface OracleKey {
  tenancy: string;
  user: string;
  fingerprint: string;
  privateKey: CryptoKey;
}

export const SIGNED_HEADERS = ['(request-target)', 'host', 'date', 'x-content-sha256', 'content-type', 'content-length'] as const;

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const PKCS8 = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/;

const base64 = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/** The PKCS#8 PEM's key for signing, or `null` for anything else (a PKCS#1 key included); never throws. */
export async function importKey(pem: string): Promise<CryptoKey | null> {
  const match = PKCS8.exec(pem.trim());
  if (match === null) return null;
  try {
    const der = Uint8Array.from(atob((match[1] as string).replace(/\s/g, '')), (char) => char.charCodeAt(0));
    return await crypto.subtle.importKey('pkcs8', der, ALGORITHM, false, ['sign']);
  } catch {
    return null;
  }
}

/** The four signed values a request carries itself; `(request-target)` and `host` come from its URL. */
export type SignedValues = {
  date: string;
  'x-content-sha256': string;
  'content-type': string;
  'content-length': string;
};

/** The string Oracle signs: one `name: value` line per signed header, in `SIGNED_HEADERS` order, joined by newlines. */
export function signingString(url: URL, values: SignedValues): string {
  return [
    `(request-target): post ${url.pathname}${url.search}`,
    `host: ${url.host}`,
    `date: ${values.date}`,
    `x-content-sha256: ${values['x-content-sha256']}`,
    `content-type: ${values['content-type']}`,
    `content-length: ${values['content-length']}`,
  ].join('\n');
}

/** The headers a JSON POST of `body` to `url` sends, `authorization` included. */
export async function signRequest(url: URL, body: string, key: OracleKey, now: Date): Promise<SignedValues & { authorization: string }> {
  const bytes = new TextEncoder().encode(body);
  const values: SignedValues = {
    date: now.toUTCString(),
    'x-content-sha256': base64(await crypto.subtle.digest('SHA-256', bytes)),
    'content-type': 'application/json',
    'content-length': String(bytes.length),
  };
  const signature = base64(await crypto.subtle.sign(ALGORITHM, key.privateKey, new TextEncoder().encode(signingString(url, values))));
  const keyId = `${key.tenancy}/${key.user}/${key.fingerprint}`;
  const authorization = `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${SIGNED_HEADERS.join(' ')}",signature="${signature}"`;
  return { ...values, authorization };
}
