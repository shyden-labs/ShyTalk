import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MENU_ROUTES, SEALED_ROUTES, validateUiDocument, type RefusedWords, type UiDocument } from '../../packages/ui-document/index.ts';

/**
 * Made-up refused words, so no unread translation sits in a test. The real
 * lists are Shyden's to check (English) and Google's to read back (the rest).
 * Vietnamese holds a two-word phrase: its words are written apart.
 */
const REFUSED: RefusedWords = {
  en: ['refused'],
  id: ['zzditolak'],
  th: ['ซซซ'],
  vi: ['zz cam'],
  zh: ['禁禁'],
};

const manifest = (): UiDocument => JSON.parse(readFileSync('manifests/ui.json', 'utf8')) as UiDocument;
const errors = (doc: unknown, refused: RefusedWords = REFUSED): string[] => {
  const result = validateUiDocument(doc, refused);
  return result.ok ? [] : result.errors;
};
const withLine = (locale: keyof RefusedWords, line: string): UiDocument => {
  const doc = manifest();
  doc.copy[locale]['nav.rooms'] = line;
  return doc;
};

describe('the UI document: shape (AC1)', () => {
  it('passes manifests/ui.json', () => {
    expect(errors(manifest())).toEqual([]);
  });

  it('returns the parsed document when it passes', () => {
    const result = validateUiDocument(manifest(), REFUSED);
    expect(result).toEqual({ ok: true, doc: manifest() });
  });

  it('refuses a copy key missing in id, naming key and locale', () => {
    const doc = manifest();
    doc.copy.id = {};
    expect(errors(doc)).toEqual(['copy.id is missing nav.rooms']);
  });

  it('refuses a copy key missing in th, naming key and locale', () => {
    const doc = manifest();
    doc.copy.th = {};
    expect(errors(doc)).toEqual(['copy.th is missing nav.rooms']);
  });

  it('refuses a copy key missing in vi, naming key and locale', () => {
    const doc = manifest();
    doc.copy.vi = {};
    expect(errors(doc)).toEqual(['copy.vi is missing nav.rooms']);
  });

  it('refuses a copy key missing in zh, naming key and locale', () => {
    const doc = manifest();
    doc.copy.zh = {};
    expect(errors(doc)).toEqual(['copy.zh is missing nav.rooms']);
  });

  it('refuses a copy key that English lacks, naming key and locale', () => {
    const doc = manifest();
    doc.copy.th['nav.extra'] = 'ห้อง';
    expect(errors(doc)).toEqual(['copy.th has nav.extra, which English lacks']);
  });

  it('refuses a whole locale missing', () => {
    const doc = manifest() as unknown as { copy: Record<string, unknown> };
    delete doc.copy.vi;
    expect(errors(doc)).toEqual(['copy.vi: Invalid key: Expected "vi" but received undefined']);
  });

  it('refuses a locale outside the five', () => {
    const doc = manifest() as unknown as { copy: Record<string, unknown> };
    doc.copy.fr = { 'nav.rooms': 'Salons' };
    expect(errors(doc)).toEqual(['copy.fr: Invalid key: Expected never but received "fr"']);
  });

  it('refuses an empty line', () => {
    expect(errors(withLine('en', ''))).toEqual(['copy.en.nav.rooms: Invalid length: Expected >=1 but received 0']);
  });

  it('refuses an unknown top-level key', () => {
    expect(errors({ ...manifest(), extra: 1 })).toEqual(['extra: Invalid key: Expected never but received "extra"']);
  });

  it('refuses screens until Part 2', () => {
    expect(errors({ ...manifest(), screens: [] })).toEqual(['screens: Invalid key: Expected never but received "screens"']);
  });

  it('refuses a schema version other than 1', () => {
    expect(errors({ ...manifest(), schemaVersion: 2 })).toEqual(['schemaVersion: Invalid type: Expected 1 but received 2']);
  });

  it('refuses something that is not a document', () => {
    expect(errors(null)).toEqual(['(root): Invalid type: Expected Object but received null']);
  });

  it('refuses a navigation label that is not a copy key', () => {
    const doc = manifest();
    doc.navigation.push({ id: 'x', route: 'rooms', label: 'Profile' });
    expect(errors(doc)).toEqual(['navigation x label Profile is not a copy key']);
  });

  it('refuses two navigation items with one id', () => {
    const doc = manifest();
    doc.navigation.push({ id: 'rooms', route: 'rooms', label: 'nav.rooms' });
    expect(errors(doc)).toEqual(['navigation rooms is listed twice']);
  });
});

describe('the UI document: sealed routes (AC2)', () => {
  it.each(['ban', 'suspension', 'app-lock', 'cohort', 'unsafe-device', 'delete-account'])(
    'refuses the sealed route %s in navigation',
    (route) => {
      const doc = manifest();
      doc.navigation.push({ id: 'x', route, label: 'nav.rooms' });
      expect(errors(doc)).toEqual([`navigation x names sealed route ${route}`]);
    },
  );

  // A menu links only to routes the server knows as menu routes: a sealed screen under any other name is refused too.
  it.each(['account-deletion', 'age-group', 'settings/app-lock', 'App-Lock', '/ban', 'ban/', ' ban', 'unsafe_device', 'ban?x=1', 'rooms/'])(
    'refuses the route %j, which is not a menu route',
    (route) => {
      const doc = manifest();
      doc.navigation.push({ id: 'x', route, label: 'nav.rooms' });
      expect(errors(doc)).toEqual([`navigation x names route ${route}, which is not a menu route`]);
    },
  );

  it('keeps every sealed route off the menu routes', () => {
    expect(MENU_ROUTES.filter((route) => SEALED_ROUTES.includes(route))).toEqual([]);
  });

  it('lets a menu route through', () => {
    const doc = manifest();
    doc.navigation.push({ id: 'x', route: 'rooms', label: 'nav.rooms' });
    expect(errors(doc)).toEqual([]);
  });
});

describe('the UI document: refused words, the same rule in every language (AC3)', () => {
  it('refuses an English line holding a refused word, whatever its case', () => {
    expect(errors(withLine('en', 'Find a REFUSED here'))).toEqual(['copy.en.nav.rooms uses refused word refused']);
  });

  it('refuses an Indonesian line holding a refused word', () => {
    expect(errors(withLine('id', 'Cari zzditolak di sini'))).toEqual(['copy.id.nav.rooms uses refused word zzditolak']);
  });

  it('refuses a Vietnamese line holding a refused phrase', () => {
    expect(errors(withLine('vi', 'Tìm zz cam ở đây'))).toEqual(['copy.vi.nav.rooms uses refused word zz cam']);
  });

  it('refuses a Thai line holding a refused word inside other letters', () => {
    expect(errors(withLine('th', 'ห้องซซซห้อง'))).toEqual(['copy.th.nav.rooms uses refused word ซซซ']);
  });

  it('refuses a Chinese line holding a refused word inside other letters', () => {
    expect(errors(withLine('zh', '房间禁禁房间'))).toEqual(['copy.zh.nav.rooms uses refused word 禁禁']);
  });

  it('matches whole words in English, so a longer word is not refused', () => {
    expect(errors(withLine('en', 'refusedness'))).toEqual([]);
  });

  it('matches a Vietnamese phrase only when its words are together', () => {
    expect(errors(withLine('vi', 'zz và cam'))).toEqual([]);
  });

  it('checks each line against its own language only', () => {
    expect(errors(withLine('id', 'refused'))).toEqual([]);
  });

  it('refuses a refused word hidden with a zero-width space', () => {
    expect(errors(withLine('en', 'ref\u200Bused'))).toEqual(['copy.en.nav.rooms uses refused word refused']);
  });

  it('refuses a refused word written in full-width letters', () => {
    expect(errors(withLine('en', 'ｒｅｆｕｓｅｄ'))).toEqual(['copy.en.nav.rooms uses refused word refused']);
  });

  it('refuses a Thai refused word split by a space', () => {
    expect(errors(withLine('th', 'ซซ ซ'))).toEqual(['copy.th.nav.rooms uses refused word ซซซ']);
  });

  it('refuses a refused word in a copy key, against English', () => {
    const doc = manifest();
    for (const locale of ['en', 'id', 'th', 'vi', 'zh'] as const) doc.copy[locale]['refused.title'] = 'x';
    expect(errors(doc)).toEqual(['copy key refused.title uses refused word refused']);
  });

  it('refuses a refused word in a switch key written in camel case', () => {
    const doc = manifest();
    doc.switches['rooms.useRefusedMode'] = true;
    expect(errors(doc)).toEqual(['switches key rooms.useRefusedMode uses refused word refused']);
  });

  it('refuses a refused word in a token key or value', () => {
    const doc = manifest();
    doc.tokens['zz_refused'] = 'refused';
    expect(errors(doc)).toEqual(['tokens key zz_refused uses refused word refused', 'tokens value zz_refused uses refused word refused']);
  });

  it('refuses a refused word in a navigation id', () => {
    const doc = manifest();
    doc.navigation.push({ id: 'refused', route: 'rooms', label: 'nav.rooms' });
    expect(errors(doc)).toEqual(['navigation id refused uses refused word refused']);
  });

  it('refuses a refused-word list holding an empty entry, which would match everything or nothing', () => {
    expect(() => validateUiDocument(manifest(), { ...REFUSED, th: [' '] })).toThrow('refused words for th hold an empty entry');
  });
});
