import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MENU_ROUTES, SEALED_ROUTES, validateUiDocument, type UiDocument } from '../../packages/ui-document/index.ts';

const manifest = (): UiDocument => JSON.parse(readFileSync('manifests/ui.json', 'utf8')) as UiDocument;
const errors = (doc: unknown): string[] => {
  const result = validateUiDocument(doc);
  return result.ok ? [] : result.errors;
};
describe('the UI document: shape (AC1)', () => {
  it('passes manifests/ui.json', () => {
    expect(errors(manifest())).toEqual([]);
  });

  it('returns the parsed document when it passes', () => {
    const result = validateUiDocument(manifest());
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
    const doc = manifest();
    doc.copy.en['nav.rooms'] = '';
    expect(errors(doc)).toEqual(['copy.en.nav.rooms: Invalid length: Expected >=1 but received 0']);
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
