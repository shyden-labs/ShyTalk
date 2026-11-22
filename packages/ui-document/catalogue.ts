/**
 * What a server-arranged screen may be built from (plan 6.1 Task 2; app shell
 * design 5.1). Everything here is drawn by reviewed code in the app; the
 * document only arranges it. A new part, block, binding or action is added
 * here and in the app's renderer together, never by editing the document.
 */
export const PARTS = ['column', 'row', 'card', 'text', 'image', 'button', 'list', 'spacer', 'divider'] as const;
export type Part = (typeof PARTS)[number];

/** Native blocks a screen may hold whole; plan 6.2 adds the first (consentNotice). */
export const BLOCKS: readonly string[] = [];

/** The data a text may show, each read by named app code. */
export const BINDINGS = ['app.version'] as const;

export const ACTIONS = ['openRoute', 'openSheet', 'goBack', 'blockAction'] as const;

/** The routes the server may draw a screen for. */
export const SCREEN_ROUTES: readonly string[] = ['home'];

/** Images an image part may name, shipped inside the app. */
export const ASSETS: readonly string[] = ['brand.logo'];

/** The sealed update screen's words, which every document carries. */
export const REQUIRED_COPY = ['sealed.update.title', 'sealed.update.body', 'sealed.update.button'] as const;

/** How each prop of a part is checked. */
export type PropKind = 'token' | 'copy' | 'binding' | 'asset' | 'action' | readonly string[];

const LAYOUT: Record<string, PropKind> = { gap: 'token', padding: 'token', align: ['start', 'center', 'end'] };

/** The props each part takes; any other prop is refused. */
export const PART_PROPS: Record<Part, Record<string, PropKind>> = {
  column: LAYOUT,
  row: LAYOUT,
  card: LAYOUT,
  text: { copy: 'copy', bind: 'binding', style: ['title', 'body', 'caption'] },
  image: { asset: 'asset', label: 'copy' },
  button: { copy: 'copy', action: 'action', variant: ['primary', 'secondary'] },
  list: {},
  spacer: { size: 'token' },
  divider: {},
};

/** Text-and-background pairs that must reach 4.5:1 (WCAG 2.2 AA body text). */
export const CONTRAST_PAIRS: readonly (readonly [foreground: string, background: string])[] = [
  ['color.text', 'color.background'],
  ['color.onPrimary', 'color.primary'],
];
