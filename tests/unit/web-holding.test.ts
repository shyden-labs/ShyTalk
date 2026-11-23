import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { handle, holdingAnswer, holdingPath, type WebEnv } from '../../workers/web/src/web.ts';

/**
 * The holding page (shyden-labs/ShyTalk#261; Shyden 2026-11-17: "Holding page first"): while production holds,
 * every address on it answers the one holding page, in the visitor's language, and the www address sends the visitor
 * to the bare one. Nothing behind it (the API, the database, the unreleased pages) is reached.
 */

interface Settings {
  vars?: { SITE_ORIGIN?: string };
}
const WORKER = JSON.parse(readFileSync('workers/web/wrangler.json', 'utf8')) as { env: Record<string, Settings> };
/** Production's own address, from the Worker's settings: tests never name a door host. */
const PROD = new URL(WORKER.env.prod?.vars?.SITE_ORIGIN ?? 'https://missing.invalid');

/** Production holding, with no database: ASSETS records each path and answers it. */
function holding(): { env: WebEnv; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    env: {
      ENVIRONMENT_NAME: 'prod',
      HOLDING: 'true',
      ASSETS: {
        fetch: (request: Request) => {
          const { pathname } = new URL(request.url);
          asked.push(pathname);
          return Promise.resolve(new Response(`page ${pathname}`, { status: 200, headers: { 'content-type': 'text/html' } }));
        },
      },
    },
  };
}

const visit = (path: string, init: RequestInit = {}, host = PROD.host): Request => new Request(`https://${host}${path}`, init);

describe('holdingPath', () => {
  it.each([
    [null, '/holding'],
    ['', '/holding'],
    ['en-GB,en;q=0.9', '/holding'],
    ['id-ID,id;q=0.9,en;q=0.8', '/id/holding'],
    ['th', '/th/holding'],
    ['vi-VN', '/vi/holding'],
    ['zh-CN,zh;q=0.9', '/zh/holding'],
    ['zh-Hans-CN', '/zh/holding'],
    ['fr-FR,fr;q=0.9', '/holding'],
    ['fr;q=0.9, vi;q=0.5', '/vi/holding'],
    ['en;q=0.4, th;q=0.8', '/th/holding'],
    ['th;q=0, id', '/id/holding'],
    ['*', '/holding'],
    ['ID', '/id/holding'],
    ['id;q=abc, th;q=0.5', '/id/holding'],
  ])('answers %j with the holding page at %s', (languages, path) => {
    expect(holdingPath(languages)).toBe(path);
  });
});

describe('holdingAnswer (shyden-labs/ShyTalk#273)', () => {
  it.each([
    ['/', 'th', '/th/holding', 200],
    ['/', null, '/holding', 200],
    ['/en/', 'th', '/holding', 200],
    ['/en', 'th', '/holding', 200],
    ['/id/', 'en', '/id/holding', 200],
    ['/id', 'en', '/id/holding', 200],
    ['/th/', 'vi', '/th/holding', 200],
    ['/vi/', null, '/vi/holding', 200],
    ['/zh/', 'id', '/zh/holding', 200],
    ['/ID/', 'th', '/th/holding', 404],
    ['/xx/', 'vi', '/vi/holding', 404],
    ['/id/sign-in/', 'th', '/th/holding', 404],
    ['/holding', null, '/holding', 404],
  ] as const)('answers %s, asked in %j, with %s and %i', (pathname, languages, page, status) => {
    expect(holdingAnswer(pathname, languages)).toEqual({ page, status });
  });
});

describe('a holding production', () => {
  it('answers its home with the holding page, 200, without needing a database, carrying the security headers', async () => {
    const { env, asked } = holding();
    const response = await handle(visit('/'), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('page /holding');
    expect(asked).toEqual(['/holding']);
    expect(response.headers.get('vary')).toBe('accept-language');
    expect(response.headers.get('content-security-policy')).not.toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers in the visitor’s language', async () => {
    const { env, asked } = holding();
    await handle(visit('/', { headers: { 'accept-language': 'th-TH,th;q=0.9' } }), env);
    expect(asked).toEqual(['/th/holding']);
  });

  it.each(['/sign-in/', '/ID/', '/xx/', '/id/sign-in/', '/closed-testing', '/api/app/sign-in-methods', '/api/closed-testing', '/holding'])(
    'answers %s with the holding page as a 404, reaching nothing behind it',
    async (path) => {
      const { env, asked } = holding();
      const response = await handle(visit(path, { headers: { 'accept-language': 'vi' } }), env);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('page /vi/holding');
      expect(asked).toEqual(['/vi/holding']);
    },
  );

  // shyden-labs/ShyTalk#317 (Shyden 2026-11-22): while production holds, the legal pages answer too, in English and
  // Indonesian, the only languages they are written in; ShyDesk's support form links to them (shyden-labs/shydesk#78).
  it.each(['/privacy', '/terms', '/guidelines', '/privacy/', '/id/privacy', '/id/terms', '/id/guidelines', '/id/terms/'])(
    'serves the legal page %s as built, 200',
    async (path) => {
      const { env, asked } = holding();
      const response = await handle(visit(`${path}?from=th`, { headers: { 'accept-language': 'vi' } }), env);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`page ${path}`);
      expect(asked).toEqual([path]);
    },
  );

  it.each(['/th/privacy', '/vi/terms', '/zh/guidelines', '/privacy-old', '/id/privacy/more', '/en/privacy'])(
    'answers %s, which is no legal page, with the holding page as a 404',
    async (path) => {
      const { env, asked } = holding();
      const response = await handle(visit(path, { headers: { 'accept-language': 'vi' } }), env);
      expect(response.status).toBe(404);
      expect(asked).toEqual(['/vi/holding']);
    },
  );

  it('answers each language’s home with that language’s holding page, whatever the header asks, so the switch works', async () => {
    const { env, asked } = holding();
    const response = await handle(visit('/th/', { headers: { 'accept-language': 'en' } }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('page /th/holding');
    expect(asked).toEqual(['/th/holding']);
    expect(response.headers.get('vary')).toBe('accept-language');
  });

  it.each(['/styles/site.css', '/previews/index.png', '/icons/favicon-32.png', '/_astro/outfit-latin-800-normal.woff2'])(
    'serves %s, which the holding page and its link preview use, as built',
    async (path) => {
      const { env, asked } = holding();
      const response = await handle(visit(path), env);
      expect(response.status).toBe(200);
      expect(asked).toEqual([path]);
    },
  );

  it('sends the www address to the bare one, keeping the path and query', async () => {
    const { env, asked } = holding();
    const response = await handle(visit('/sign-in/?from=mail', {}, `www.${PROD.host}`), env);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${PROD.origin}/sign-in/?from=mail`);
    expect(asked).toEqual([]);
  });
});
