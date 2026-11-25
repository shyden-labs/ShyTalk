import { describe, it, expect } from 'vitest';
import { handle, type WebEnv } from '../../workers/web/src/web.ts';
import { fillPage, roadmapLocale, MARKS } from '../../workers/web/src/roadmap/page.ts';
import { DOOR_SECRET_HEADER, type D1Like } from '../../packages/environment/index.ts';
import type { Milestone, Words } from '../../apps/web/src/roadmap/view.ts';

/**
 * The roadmap page (shyden-labs/ShyTalk#321 AC3): the Worker answers `/roadmap` and `/{locale}/roadmap` with the built
 * page and the Durable Object's latest snapshot already drawn into it, so a visitor sees the board at once, never a
 * loading line. With no snapshot to give, or one it cannot read, the page answers as built: its heading and intro, no
 * map, and no error, since a failed read is never shown to visitors (Shyden 2026-11-23).
 */

const WORDS: Words = {
  done: 'Done',
  started: 'Under way, {percent}% done',
  notStarted: 'Not started yet',
  labelDone: 'done',
  labelStarted: 'under way',
  labelNotStarted: 'not started',
  brings: 'What this brings',
  close: 'Close',
  bar: '{percent}% of the work to launch is done',
  barLabel: '{percent} percent done',
  mapLabel: "ShyTalk's road to launch drawn as a conversation of {count} speech bubbles",
  unnamed: 'Milestone {number}',
  updated: 'Last updated {date}, {time} {zone}',
};

const GROUNDWORK: Milestone = {
  name: 'Groundwork',
  summary: 'The workshop.',
  brings: ['Tools'],
  closed: 18,
  total: 18,
  percent: 100,
  state: 'done',
};
const WEBSITE: Milestone = {
  name: 'The website',
  summary: 'The site.',
  brings: ['Help'],
  closed: 1,
  total: 4,
  percent: 25,
  state: 'started',
};

const SNAPSHOT = {
  milestones: [GROUNDWORK, WEBSITE],
  progress: ['By tickets: …', 'By effort: …'],
  version: 7,
  readAt: '2026-11-24T23:49:00.000Z',
  stale: false,
  readFailed: true,
};

/** The built page's body, as Roadmap.astro writes it: each place the Worker fills, marked. */
const BUILT = `<html><body><h1>The road to launch</h1><p>Intro.</p>${MARKS.map}${MARKS.bar}${MARKS.updated}${MARKS.snapshot}</body></html>`;

describe('roadmapLocale', () => {
  it.each([
    ['/roadmap', 'en'],
    ['/roadmap/', 'en'],
    ['/id/roadmap', 'id'],
    ['/th/roadmap/', 'th'],
    ['/vi/roadmap', 'vi'],
    ['/zh/roadmap', 'zh'],
  ])('answers %s in %s', (path, locale) => {
    expect(roadmapLocale(path)).toBe(locale);
  });

  it.each(['/en/roadmap', '/fr/roadmap', '/roadmap.html', '/roadmaps', '/id/roadmap/x', '/api/roadmap.json'])('leaves %s alone', (path) => {
    expect(roadmapLocale(path)).toBeNull();
  });
});

describe('fillPage', () => {
  const page = fillPage(BUILT, SNAPSHOT, 'en', WORDS, null);

  it('draws the map and its buttons where the page marks them, with the one panel shut', () => {
    expect(page).toContain('<div class="map"><svg viewBox="0 0 1000 440" aria-hidden="true"');
    expect(page).toContain('aria-label="Groundwork, done"');
    expect(page).toContain('aria-label="The website, under way"');
    expect(page).toContain('<div id="roadmap-panel" class="panel" hidden></div>');
  });

  it('writes the one bar from every milestone’s stories, as a drawing and as words', () => {
    // 19 of 22 stories: 86%.
    expect(page).toContain('<svg class="bar" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="86 percent done">');
    expect(page).toContain('<rect class="bar-done" width="86" height="4"');
    expect(page).toContain('<p class="bar-words">86% of the work to launch is done</p>');
  });

  it('writes the read time in UTC, which the browser rewords in its own zone at once', () => {
    expect(page).toContain(
      '<p id="roadmap-updated" class="updated" data-read-at="2026-11-24T23:49:00.000Z">Last updated 24 November 2026, 23:49 UTC</p>',
    );
  });

  it('hands the browser the snapshot it drew, without the failing flag, and safe inside a script element', () => {
    const json = /<script type="application\/json" id="roadmap-snapshot">(.*?)<\/script>/s.exec(page)?.[1] ?? '';
    expect(JSON.parse(json)).toEqual({ milestones: SNAPSHOT.milestones, version: 7, readAt: SNAPSHOT.readAt });
    const tricky = fillPage(BUILT, { ...SNAPSHOT, milestones: [{ ...GROUNDWORK, name: '</script><b>' }] }, 'en', WORDS, null);
    expect(tricky).not.toContain('</script><b>');
    expect(tricky).toContain('\\u003c/script>\\u003cb>');
  });

  it('never shows that a read failed', () => {
    // Drawn from a snapshot whose last read failed.
    expect(page).toContain('Groundwork');
    expect(page).not.toMatch(/fail|error|stale|updating/i);
  });

  it('leaves no mark behind', () => {
    for (const mark of Object.values(MARKS)) expect(page).not.toContain(mark);
  });

  it('answers the page as built, marks removed, when there is no snapshot', () => {
    expect(fillPage(BUILT, null, 'en', WORDS, null)).toBe('<html><body><h1>The road to launch</h1><p>Intro.</p></body></html>');
  });

  it('words the milestones in the page’s language', () => {
    expect(fillPage(BUILT, SNAPSHOT as never, 'id', WORDS, { Groundwork: 'Fondasi' })).toContain('aria-label="Fondasi, done"');
  });
});

const db = (environment: string): D1Like => ({
  prepare: () => ({ first: <T>() => Promise.resolve({ name: environment } as T) }),
});

function setup(answer: () => Response | Promise<Response> = () => Response.json(SNAPSHOT)) {
  const asked: string[] = [];
  const env: WebEnv = {
    ENVIRONMENT_NAME: 'prod',
    DOOR_SECRET: 'the-door-secret',
    SITE_PASSWORD: 'the-site-password',
    DB: db('prod'),
    ASSETS: {
      fetch: (request: Request) => {
        asked.push(`asset ${new URL(request.url).pathname}`);
        return Promise.resolve(new Response(BUILT, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"built"' } }));
      },
    },
    ROADMAP: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => {
          asked.push(`object ${new URL(request.url).pathname}`);
          return Promise.resolve(answer());
        },
      }),
    },
  };
  return { env, asked };
}

const at = (path: string) => new Request(`https://shytalk.app${path}`, { headers: { [DOOR_SECRET_HEADER]: 'the-door-secret' } });

describe('the roadmap page’s address', () => {
  it('answers /roadmap with the built page and the object’s snapshot drawn in, never cached', async () => {
    const { env, asked } = setup();
    const answer = await handle(at('/roadmap'), env);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(answer.headers.get('etag')).toBeNull();
    expect(answer.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(asked).toEqual(['asset /roadmap', 'object /snapshot']);
    expect(await answer.text()).toContain('aria-label="Groundwork, done"');
  });

  it('answers each language’s page from its own built page, in its own words', async () => {
    const { env, asked } = setup();
    const answer = await handle(at('/th/roadmap'), env);
    expect(asked[0]).toBe('asset /th/roadmap');
    expect(await answer.text()).toContain('<p class="bar-words">');
  });

  it.each([
    ['answers no snapshot', () => Response.json({ error: 'roadmap_unavailable' }, { status: 503 })],
    ['cannot be reached', () => Promise.reject(new Error('object gone'))],
    ['answers what is not JSON', () => new Response('<html>')],
  ])('answers the page as built when the object %s', async (_, answer) => {
    const { env } = setup(answer);
    const page = await handle(at('/roadmap'), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('<html><body><h1>The road to launch</h1><p>Intro.</p></body></html>');
  });

  it('answers the page as built when no object is bound', async () => {
    const { env } = setup();
    delete env.ROADMAP;
    expect(await (await handle(at('/roadmap'), env)).text()).not.toContain('<!--');
  });

  it('passes on what the built page answers when it is not there', async () => {
    const { env } = setup();
    env.ASSETS = { fetch: () => Promise.resolve(new Response('missing', { status: 404 })) };
    const answer = await handle(at('/roadmap'), env);
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('missing');
  });
});
