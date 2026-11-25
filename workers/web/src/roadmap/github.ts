/**
 * The roadmap reads the board as its own read-only GitHub App, `shytalk-roadmap` (shyden-labs/ShyTalk#320 AC1, #321):
 * a JWT signed with the App's key (RS256, WebCrypto) buys a one-hour installation token, which reads every page of the
 * board with the close-out's own query, after asserting the board's recorded title. GitHub hands out PKCS#1 keys,
 * which WebCrypto cannot import, so a PKCS#1 key is wrapped as PKCS#8 first. No error names the key or a token.
 */
import { ROADMAP_QUERY, parseRoadmapItems } from './board.ts';
import type { RoadmapItem } from './snapshot.ts';

export type GithubFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface RoadmapApp {
  appId: string;
  installationId: string;
  /** The App's private key, PEM, PKCS#1 or PKCS#8 (the `ROADMAP_APP_KEY` secret). */
  key: string;
  board: { id: string; title: string };
  /** Where GitHub's API answers: GitHub itself unless the CI smoke's stand-in is named (worker.ts checks which). */
  api?: string;
}

export const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'shytalk-roadmap';

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
const textBase64Url = (text: string): string => base64Url(new TextEncoder().encode(text));

/** A DER length: short form under 128, else the long form. */
export function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
  return [0x80 + bytes.length, ...bytes];
}
const der = (tag: number, body: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array([tag, ...derLength(body.length), ...body]);

/** PKCS#8's PrivateKeyInfo around a PKCS#1 RSAPrivateKey: version 0, the rsaEncryption algorithm, the key. */
function pkcs8OfPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, new Uint8Array([...version, ...rsaEncryption, ...der(0x04, pkcs1)]));
}

/** The key's PKCS#8 bytes, or throws naming the secret, never its text. */
function pkcs8Of(pem: string): Uint8Array<ArrayBuffer> {
  const match = /-----BEGIN (RSA )?PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END (?:RSA )?PRIVATE KEY-----/u.exec(pem);
  if (match === null) throw new Error('roadmap: ROADMAP_APP_KEY is not a PEM private key');
  const bytes = new Uint8Array(Array.from(atob(String(match[2]).replaceAll(/\s/gu, '')), (char) => Number(char.codePointAt(0))));
  return match[1] === undefined ? bytes : pkcs8OfPkcs1(bytes);
}

/** The App's JWT at `now` (ms): issued a minute back, for clock drift, and lasting nine minutes, under GitHub's ten. */
export async function appJwt(appId: string, pem: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pkcs8Of(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const seconds = Math.floor(now / 1000);
  const header = textBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = textBase64Url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function installationToken(app: RoadmapApp, send: GithubFetch, now: number): Promise<string> {
  const answer = await send(`${app.api ?? GITHUB_API}/app/installations/${app.installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await appJwt(app.appId, app.key, now)}`,
      accept: 'application/vnd.github+json',
      'user-agent': USER_AGENT,
    },
  });
  if (answer.status !== 201) throw new Error(`roadmap: GitHub answered ${String(answer.status)} for the installation token`);
  const token = ((await answer.json()) as { token?: unknown }).token;
  if (typeof token !== 'string' || token === '') throw new Error('roadmap: GitHub gave no installation token');
  return token;
}

interface Page {
  data?: { node: { title?: string; items: { pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null };
  errors?: { message: string }[];
}

/** One board page, checked: GitHub's status, GraphQL's own errors, a board at all, and its recorded title. */
async function boardPage(app: RoadmapApp, send: GithubFetch, token: string, endCursor: string | null): Promise<Page> {
  const answer = await send(`${app.api ?? GITHUB_API}/graphql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
    body: JSON.stringify({ query: ROADMAP_QUERY, variables: { id: app.board.id, endCursor } }),
  });
  if (answer.status !== 200) throw new Error(`roadmap: GitHub answered ${String(answer.status)} for the board`);
  const page = (await answer.json()) as Page;
  if (page.errors !== undefined && page.errors.length > 0) {
    throw new Error(`roadmap: GitHub refused the board read: ${page.errors.map(({ message }) => message).join('; ')}`);
  }
  const board = page.data?.node;
  if (board === null || board === undefined) throw new Error(`roadmap: GitHub returned no board for ${app.board.id}`);
  if (board.title !== app.board.title) {
    throw new Error(`roadmap: board ${app.board.id} is titled "${String(board.title)}", not "${app.board.title}"`);
  }
  return page;
}

/** Every item on the App's board, read page by page as the close-out reads it. */
export async function readRoadmapBoard(app: RoadmapApp, send: GithubFetch, now: number): Promise<RoadmapItem[]> {
  const token = await installationToken(app, send, now);
  return parseRoadmapItems(await pagesFrom(app, send, token, null));
}

/** The board's pages from `endCursor` on: each page names the next, so they are read one after another. */
async function pagesFrom(app: RoadmapApp, send: GithubFetch, token: string, endCursor: string | null): Promise<Page[]> {
  const page = await boardPage(app, send, token, endCursor);
  const info = page.data?.node?.items.pageInfo;
  if (info?.hasNextPage !== true || info.endCursor === null) return [page];
  return [page, ...(await pagesFrom(app, send, token, info.endCursor))];
}
