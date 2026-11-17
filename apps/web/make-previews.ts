/**
 * Makes every page's link-preview picture (shyden-labs/ShyTalk#198 AC2): a real
 * screenshot of the top of each built page, one per page and language,
 * 1200 by 630, into `apps/web/public/previews/`, to be committed. Shyden's
 * ruling 2026-11-14 (shyden-labs/shyden.co.uk#1158).
 *
 *   SITE_ENVIRONMENT=dev npm run build:web && node apps/web/make-previews.ts
 *
 * The built pages are served from `apps/web/dist` by a plain file server in
 * this process, as Workers' assets serve them (`/x` is `x.html`, `/x/` is
 * `x/index.html`), and shot in Chromium. The pictures land in `public/`, so
 * the next build carries them.
 */
import { createServer, type Server } from 'node:http';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { makePreviews, PREVIEW_HEIGHT, PREVIEW_WIDTH } from './src/preview.ts';

const DIST = fileURLToPath(new URL('dist', import.meta.url));
const OUT = fileURLToPath(new URL('public/previews', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const isFile = async (path: string): Promise<boolean> => (await stat(path).catch(() => undefined))?.isFile() ?? false;

/** The built file a path names, as Workers' assets find it; undefined when there is none. */
async function fileFor(path: string): Promise<string | undefined> {
  const relative = normalize(decodeURIComponent(path)).replace(/^\/+/, '');
  if (relative.startsWith('..')) return undefined;
  for (const candidate of relative === '' || relative.endsWith('/') ? [`${relative}index.html`] : [relative, `${relative}.html`]) {
    if (await isFile(join(DIST, candidate))) return join(DIST, candidate);
  }
  return undefined;
}

function serve(): Promise<Server> {
  const server = createServer((request, response) => {
    void (async () => {
      const file = await fileFor(new URL(request.url ?? '/', 'http://local').pathname);
      if (file === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(await readFile(file));
    })();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    }),
  );
}

const server = await serve();
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('the file server has no port');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }, deviceScaleFactor: 1 });
  const count = await makePreviews(`http://127.0.0.1:${String(address.port)}`, OUT, {
    pages: () =>
      readdirSync(DIST, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.html'))
        .map((file) => file.replaceAll('\\', '/'))
        .sort(),
    shoot: async (url, file) => {
      const response = await page.goto(url, { waitUntil: 'load' });
      if (response === null) throw new Error(`no answer from ${url}`);
      await mkdir(dirname(file), { recursive: true });
      await page.screenshot({ path: file });
    },
  });
  console.log(`make-previews: ${String(count)} pictures in ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
