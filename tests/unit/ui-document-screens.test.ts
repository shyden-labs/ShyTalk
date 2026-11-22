import { describe, it, expect } from 'vitest';
import { validateUiDocument } from '../../packages/ui-document/index.ts';
import { contrastRatio } from '../../packages/ui-document/contrast.ts';
import { ACTIONS, BINDINGS, PARTS, REQUIRED_COPY, SCREEN_ROUTES } from '../../packages/ui-document/catalogue.ts';

/**
 * The document's screens (plan 6.1 Task 2; app shell design 5.1): per route,
 * one layout tree per size class, built only from the catalogue named in
 * reviewed code. Each refusal names where it is and what is wrong.
 */

type Json = Record<string, unknown>;

const english = {
  'nav.home': 'Home',
  'home.title': 'Welcome to ShyTalk',
  'home.more': 'More',
  'sealed.update.title': 'Update ShyTalk',
  'sealed.update.body': 'This version of ShyTalk is no longer supported. Update it to keep going.',
  'sealed.update.button': 'Update',
};

/** A valid version 2 document; each test breaks one thing in its own copy. */
function doc(): Json {
  return {
    schemaVersion: 2,
    navigation: [{ id: 'home', route: 'home', label: 'nav.home' }],
    tokens: {
      'color.background': '#FFFFFF',
      'color.text': '#1A1A1A',
      'color.primary': '#6D28D9',
      'color.onPrimary': '#FFFFFF',
      'size.s': 8,
      'size.m': 16,
      'radius.card': 12,
    },
    switches: {},
    copy: { en: { ...english }, id: { ...english }, th: { ...english }, vi: { ...english }, zh: { ...english } },
    screens: {
      home: {
        compact: {
          id: 'root',
          part: 'column',
          props: { gap: 'size.m', padding: 'size.s', align: 'center' },
          children: [
            { id: 'logo', part: 'image', props: { asset: 'brand.logo', label: 'home.title' } },
            { id: 'title', part: 'text', props: { copy: 'home.title', style: 'title' } },
            { id: 'version', part: 'text', props: { bind: 'app.version', style: 'caption' } },
            { id: 'more', part: 'button', props: { copy: 'home.more', variant: 'primary', action: { do: 'openRoute', route: 'home' } } },
          ],
        },
      },
    },
  };
}

const errors = (input: unknown): string[] => {
  const result = validateUiDocument(input);
  return result.ok ? [] : result.errors;
};

/** The home screen's compact tree's children, to break one. */
const children = (d: Json): Json[] =>
  ((d['screens'] as Record<string, Record<string, Json>>)['home']?.['compact']?.['children'] ?? []) as Json[];
const node = (d: Json, id: string): Json => {
  const found = children(d).find((child) => child['id'] === id);
  if (!found) throw new Error(`no node ${id}`);
  return found;
};
const props = (d: Json, id: string): Json => node(d, id)['props'] as Json;
/** The home screen's compact tree itself. */
const root = (d: Json): Json => (d['screens'] as Record<string, Record<string, Json>>)['home']?.['compact'] as Json;

describe('the catalogue', () => {
  it('names the parts, bindings and actions reviewed code draws', () => {
    expect(PARTS).toEqual(['column', 'row', 'card', 'text', 'image', 'button', 'list', 'spacer', 'divider']);
    expect(BINDINGS).toEqual(['app.version']);
    expect(ACTIONS).toEqual(['openRoute', 'openSheet', 'goBack', 'blockAction']);
    expect(SCREEN_ROUTES).toEqual(['home']);
    expect(REQUIRED_COPY).toEqual(['sealed.update.title', 'sealed.update.body', 'sealed.update.button']);
  });
});

describe('the UI document, version 2: screens', () => {
  it('passes a valid document', () => {
    expect(errors(doc())).toEqual([]);
  });

  it('passes a medium layout with no expanded one', () => {
    const d = doc();
    const home = (d['screens'] as Record<string, Json>)['home'] as Json;
    home['medium'] = { id: 'root', part: 'row', children: [{ id: 'title', part: 'text', props: { copy: 'home.title' } }] };
    expect(errors(d)).toEqual([]);
  });

  it('refuses schema version 1', () => {
    expect(errors({ ...doc(), schemaVersion: 1 })).toEqual(['schemaVersion: Invalid type: Expected 2 but received 1']);
  });

  it('refuses a part not in the catalogue', () => {
    const d = doc();
    node(d, 'title')['part'] = 'carousel';
    expect(errors(d)).toEqual(['screens.home.compact: part carousel is not in the catalogue']);
  });

  it('refuses a block that is not a native block', () => {
    const d = doc();
    children(d).push({ id: 'chat', block: 'chat' });
    expect(errors(d)).toEqual(['screens.home.compact: block chat is not a native block']);
  });

  it('refuses a copy key English lacks', () => {
    const d = doc();
    props(d, 'title')['copy'] = 'home.nope';
    expect(errors(d)).toEqual(['screens.home.compact: copy key home.nope is missing']);
  });

  it('refuses an image label English lacks', () => {
    const d = doc();
    props(d, 'logo')['label'] = 'home.nope';
    expect(errors(d)).toEqual(['screens.home.compact: copy key home.nope is missing']);
  });

  it('refuses a token the document lacks', () => {
    const d = doc();
    root(d)['props'] = { gap: 'size.huge' };
    expect(errors(d)).toEqual(['screens.home.compact: token size.huge is missing']);
  });

  it('refuses a raw colour where a token is due', () => {
    const d = doc();
    root(d)['props'] = { padding: '#ff0000' };
    expect(errors(d)).toEqual(['screens.home.compact: padding must name a token']);
  });

  it('refuses a raw number where a token is due', () => {
    const d = doc();
    root(d)['props'] = { padding: 12 };
    expect(errors(d)).toEqual(['screens.home.compact: padding must name a token']);
  });

  it('refuses a binding not in the catalogue', () => {
    const d = doc();
    props(d, 'version')['bind'] = 'member.email';
    expect(errors(d)).toEqual(['screens.home.compact: binding member.email is not in the catalogue']);
  });

  it('refuses an action not in the catalogue', () => {
    const d = doc();
    props(d, 'more')['action'] = { do: 'openUrl', route: 'home' };
    expect(errors(d)).toEqual(['screens.home.compact: action openUrl is not in the catalogue']);
  });

  it('refuses opening a route with no screen', () => {
    const d = doc();
    props(d, 'more')['action'] = { do: 'openRoute', route: 'rooms' };
    expect(errors(d)).toEqual(['screens.home.compact: openRoute names route rooms, which has no screen']);
  });

  it('refuses a button action given as text', () => {
    const d = doc();
    props(d, 'more')['action'] = 'home';
    expect(errors(d)).toEqual(['screens.home.compact: button action must be an action']);
  });

  it('refuses a copy key given as a number', () => {
    const d = doc();
    props(d, 'title')['copy'] = 7;
    expect(errors(d)).toEqual(['screens.home.compact: text copy must be text']);
  });

  it('refuses opening a sheet with no screen', () => {
    const d = doc();
    props(d, 'more')['action'] = { do: 'openSheet', route: 'rooms' };
    expect(errors(d)).toEqual(['screens.home.compact: openSheet names route rooms, which has no screen']);
  });

  it('refuses opening a route without naming one', () => {
    const d = doc();
    props(d, 'more')['action'] = { do: 'openRoute' };
    expect(errors(d)).toEqual(['screens.home.compact: openRoute names route (none), which has no screen']);
  });

  it('passes a button that goes back', () => {
    const d = doc();
    props(d, 'more')['action'] = { do: 'goBack' };
    expect(errors(d)).toEqual([]);
  });

  it('refuses a prop the part does not take', () => {
    const d = doc();
    props(d, 'title')['onPress'] = 'x';
    expect(errors(d)).toEqual(['screens.home.compact: text takes no prop onPress']);
  });

  it('refuses a text with neither copy nor a binding', () => {
    const d = doc();
    node(d, 'title')['props'] = { style: 'title' };
    expect(errors(d)).toEqual(['screens.home.compact: text title names neither copy nor a binding']);
  });

  it('refuses a style a text does not have', () => {
    const d = doc();
    props(d, 'title')['style'] = 'shout';
    expect(errors(d)).toEqual(['screens.home.compact: text style shout is not one of title, body, caption']);
  });

  it('refuses an image asset the app does not ship', () => {
    const d = doc();
    props(d, 'logo')['asset'] = 'https://example.com/a.png';
    expect(errors(d)).toEqual(['screens.home.compact: image asset https://example.com/a.png is not shipped in the app']);
  });

  it('refuses a screen under a route that is not a screen route', () => {
    const d = doc();
    (d['screens'] as Record<string, unknown>)['rooms'] = { compact: { id: 'root', part: 'column' } };
    expect(errors(d)).toEqual(['screens.rooms: rooms is not a screen route']);
  });

  it('refuses a screen under a sealed route', () => {
    const d = doc();
    (d['screens'] as Record<string, unknown>)['update'] = { compact: { id: 'root', part: 'column' } };
    expect(errors(d)).toEqual(['screens.update: update is sealed, so the server never draws it']);
  });

  it('refuses a navigation item naming the sealed update route', () => {
    const d = doc();
    (d['navigation'] as Json[]).push({ id: 'update', route: 'update', label: 'nav.home' });
    expect(errors(d)).toEqual(['navigation update names sealed route update']);
  });

  it('refuses a navigation route with no screen', () => {
    const d = doc();
    delete (d['screens'] as Record<string, unknown>)['home'];
    expect(errors(d)).toEqual(['navigation home names route home, which has no screen']);
  });

  it('refuses a document missing a sealed screen line', () => {
    const d = doc();
    for (const lines of Object.values(d['copy'] as Record<string, Record<string, string>>)) delete lines['sealed.update.title'];
    expect(errors(d)).toEqual(['copy.en is missing sealed.update.title, which the sealed update screen needs']);
  });

  it('refuses two nodes in one screen sharing an id', () => {
    const d = doc();
    node(d, 'version')['id'] = 'title';
    expect(errors(d)).toEqual(['screens.home.compact: node id title is used twice']);
  });

  it('refuses body text under 4.5:1 on the background', () => {
    const d = doc();
    (d['tokens'] as Json)['color.text'] = '#949494';
    expect(errors(d)).toEqual(['tokens: color.text on color.background contrast 3.0:1 is under 4.5:1']);
  });

  it('refuses button text under 4.5:1 on the primary colour', () => {
    const d = doc();
    (d['tokens'] as Json)['color.primary'] = '#A78BFA';
    expect(errors(d)).toEqual(['tokens: color.onPrimary on color.primary contrast 2.7:1 is under 4.5:1']);
  });

  it('refuses a colour token that is not #RRGGBB', () => {
    const d = doc();
    (d['tokens'] as Json)['color.text'] = 'black';
    expect(errors(d)).toEqual(['tokens: color.text must be #RRGGBB']);
  });
});

describe('contrastRatio', () => {
  it('gives black on white 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('gives the same ratio either way round', () => {
    expect(contrastRatio('#FFFFFF', '#6D28D9')).toBeCloseTo(contrastRatio('#6D28D9', '#FFFFFF'), 10);
  });

  // #767676 is the lightest grey that reaches 4.5:1 on white, a figure WCAG's own examples give.
  it('gives #767676 on white 4.54:1', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('gives a colour on itself 1:1', () => {
    expect(contrastRatio('#949494', '#949494')).toBeCloseTo(1, 10);
  });

  it('refuses a colour that is not #RRGGBB', () => {
    expect(() => contrastRatio('#FFF', '#000000')).toThrow('contrastRatio: #FFF is not #RRGGBB');
  });
});
