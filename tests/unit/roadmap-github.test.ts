import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { appJwt, derLength, readRoadmapBoard, type GithubFetch } from '../../workers/web/src/roadmap/github.ts';
import { ROADMAP_QUERY } from '../../workers/web/src/roadmap/board.ts';

/**
 * The roadmap reads the board as its own read-only GitHub App, `shytalk-roadmap` (shyden-labs/ShyTalk#320 AC1, #321):
 * a JWT signed with the App's key buys a one-hour installation token, which reads every page of the board with the
 * close-out's own query, after asserting the board's title. GitHub hands out PKCS#1 keys; both PKCS#1 and PKCS#8 are
 * taken. Nothing here prints the key or a token.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PKCS1 = privateKey.export({ type: 'pkcs1', format: 'pem' });
const PKCS8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const NOW = Date.parse('2026-11-23T07:00:00Z');
const BOARD = { id: 'PVT_kwDOEOcG584BpkXr', title: 'ShyTalk Stories' };
const APP = { appId: '5880693', installationId: '184830629', key: PKCS1, board: BOARD };

const fromBase64Url = (text: string): Buffer => Buffer.from(text.replaceAll('-', '+').replaceAll('_', '/'), 'base64');

function node(number: number) {
  return {
    estimate: { number: 3 },
    priority: { name: 'P1' },
    publicTitle: { text: `Public ${String(number)}` },
    publicSummary: null,
    content: {
      __typename: 'Issue',
      number,
      title: `Internal ${String(number)}`,
      state: 'OPEN',
      createdAt: '2026-11-01T00:00:00Z',
      closedAt: null,
      stateReason: null,
      labels: { nodes: [] },
      parent: null,
    },
  };
}
const page = (numbers: number[], next: string | null, title = BOARD.title) => ({
  data: {
    node: {
      title,
      items: { totalCount: 3, pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes: numbers.map(node) },
    },
  },
});

interface Sent {
  url: string;
  init: RequestInit | undefined;
}
function github(pages: unknown[], token: Response = Response.json({ token: 'ghs_installation' }, { status: 201 })) {
  const sent: Sent[] = [];
  let at = 0;
  const send: GithubFetch = (url, init) => {
    sent.push({ url, init });
    if (url.endsWith('/access_tokens')) return Promise.resolve(token.clone());
    const answer = pages[at] ?? pages.at(-1);
    at += 1;
    return Promise.resolve(answer instanceof Response ? answer : Response.json(answer));
  };
  return { sent, send };
}

describe('the roadmap’s GitHub App', () => {
  it.each([
    ['PKCS#1', PKCS1],
    ['PKCS#8', PKCS8],
  ])('signs a JWT with a %s key that the App’s public key verifies, issued a minute back and lasting under ten', async (_kind, key) => {
    const jwt = await appJwt(APP.appId, key, NOW);
    const [header = '', payload = '', signature = ''] = jwt.split('.');
    expect(JSON.parse(fromBase64Url(header).toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(fromBase64Url(payload).toString())).toEqual({ iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: '5880693' });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey(privateKey), fromBase64Url(signature))).toBe(true);
  });

  it.each([
    [5, [5]],
    [127, [127]],
    [128, [0x81, 128]],
    [300, [0x82, 1, 44]],
  ])('writes a DER length of %i as %j', (length, bytes) => {
    expect(derLength(length)).toEqual(bytes);
  });

  it('refuses a key that is no PEM private key, naming neither the key nor its text', async () => {
    await expect(appJwt(APP.appId, 'not a key at all', NOW)).rejects.toThrow('roadmap: ROADMAP_APP_KEY is not a PEM private key');
  });

  it('buys an installation token with the JWT, then reads every page of the board with the close-out’s query', async () => {
    const gh = github([page([1, 2], 'cursor-1'), page([3], null)]);
    const items = await readRoadmapBoard(APP, gh.send, NOW);
    expect(items.map(({ number, publicTitle }) => [number, publicTitle])).toEqual([
      [1, 'Public 1'],
      [2, 'Public 2'],
      [3, 'Public 3'],
    ]);
    const [buy, first, second] = gh.sent;
    expect(buy?.url).toBe('https://api.github.com/app/installations/184830629/access_tokens');
    expect(buy?.init?.method).toBe('POST');
    expect(new Headers(buy?.init?.headers).get('authorization')).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/u);
    expect(first?.url).toBe('https://api.github.com/graphql');
    expect(new Headers(first?.init?.headers).get('authorization')).toBe('Bearer ghs_installation');
    expect(new Headers(first?.init?.headers).get('user-agent')).toBe('shytalk-roadmap');
    expect(JSON.parse(first?.init?.body as string)).toEqual({ query: ROADMAP_QUERY, variables: { id: BOARD.id, endCursor: null } });
    expect(JSON.parse(second?.init?.body as string)).toEqual({ query: ROADMAP_QUERY, variables: { id: BOARD.id, endCursor: 'cursor-1' } });
    expect(gh.sent).toHaveLength(3);
  });

  it('refuses a board whose title is not the one recorded, reading no further', async () => {
    const gh = github([page([1], 'more', 'ShyTalk Stories (legacy)')]);
    await expect(readRoadmapBoard(APP, gh.send, NOW)).rejects.toThrow(
      'roadmap: board PVT_kwDOEOcG584BpkXr is titled "ShyTalk Stories (legacy)", not "ShyTalk Stories"',
    );
    expect(gh.sent).toHaveLength(2);
  });

  it('fails naming the status when GitHub refuses the token, and never a token or key', async () => {
    const gh = github([], Response.json({ message: 'Bad credentials' }, { status: 401 }));
    const failing = readRoadmapBoard(APP, gh.send, NOW);
    await expect(failing).rejects.toThrow('roadmap: GitHub answered 401 for the installation token');
    await expect(failing).rejects.not.toThrow('PRIVATE KEY');
  });

  it('fails naming the status when a board page is refused', async () => {
    const gh = github([new Response('upstream', { status: 502 })]);
    await expect(readRoadmapBoard(APP, gh.send, NOW)).rejects.toThrow('roadmap: GitHub answered 502 for the board');
  });

  it('fails naming GraphQL’s own errors, and a page with no board', async () => {
    const errors = github([{ errors: [{ message: 'Could not resolve to a node' }] }]);
    await expect(readRoadmapBoard(APP, errors.send, NOW)).rejects.toThrow(
      'roadmap: GitHub refused the board read: Could not resolve to a node',
    );
    const empty = github([{ data: { node: null } }]);
    await expect(readRoadmapBoard(APP, empty.send, NOW)).rejects.toThrow('roadmap: GitHub returned no board for PVT_kwDOEOcG584BpkXr');
  });

  it('fails when the token answer carries no token', async () => {
    const gh = github([], Response.json({}, { status: 201 }));
    await expect(readRoadmapBoard(APP, gh.send, NOW)).rejects.toThrow('roadmap: GitHub gave no installation token');
  });
});
