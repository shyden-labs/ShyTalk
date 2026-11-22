/**
 * The app's UI document: menus, colours, sizes, switches and words, sent by
 * the server (plan 4 Task 5, shyden-labs/ShyTalk#78; live-app design D6).
 * `validateUiDocument` is the only way a document is accepted for publishing.
 */
import * as v from 'valibot';
import {
  ACTIONS,
  ASSETS,
  BINDINGS,
  BLOCKS,
  CONTRAST_PAIRS,
  PART_PROPS,
  PARTS,
  REQUIRED_COPY,
  SCREEN_ROUTES,
  type Part,
} from './catalogue.ts';
import { contrastRatio, isHexColour } from './contrast.ts';

export const LOCALES = ['en', 'id', 'th', 'vi', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The routes a menu may link to. Anything else is refused, whatever its name,
 * so a server-controlled screen cannot reach a menu under a name nobody
 * listed. A new menu route is added here, in reviewed code, never by editing
 * the document. Grows with the app's screens (plan 6); `rooms` returns with plan 7.
 */
export const MENU_ROUTES: readonly string[] = ['home'];

/**
 * Screens the app alone draws and the server alone opens (ban and suspension,
 * App-Lock, cohort segregation, unsafe device, account deletion, update to
 * continue): never a menu route nor a server-arranged screen, held
 * apart by a test, and named in the refusal when a document tries one.
 */
export const SEALED_ROUTES: readonly string[] = ['ban', 'suspension', 'app-lock', 'cohort', 'unsafe-device', 'delete-account', 'update'];

const Text = v.pipe(v.string(), v.minLength(1));
const Lines = v.record(Text, Text);
const NavItem = v.strictObject({
  id: Text,
  route: Text,
  /** A copy key, so every menu label is translated. */
  label: Text,
});
/** An action a button takes; which ones exist, and where they lead, is checked against the catalogue. */
const ActionShape = v.strictObject({ do: Text, route: v.optional(Text), block: v.optional(Text), name: v.optional(Text) });
export type Action = v.InferOutput<typeof ActionShape>;
const PropValue = v.union([v.string(), v.number(), v.boolean(), ActionShape]);

export type BlockNode = { id: string; block: string; options?: Record<string, string | boolean> | undefined };
export type PartNode = {
  id: string;
  part: string;
  props?: Record<string, string | number | boolean | Action> | undefined;
  children?: Node[] | undefined;
};
export type Node = PartNode | BlockNode;

const BlockNodeShape = v.strictObject({ id: Text, block: Text, options: v.optional(v.record(Text, v.union([v.string(), v.boolean()]))) });
const NodeShape: v.GenericSchema<Node> = v.lazy(() =>
  v.union([
    v.strictObject({ id: Text, part: Text, props: v.optional(v.record(Text, PropValue)), children: v.optional(v.array(NodeShape)) }),
    BlockNodeShape,
  ]),
);
/** One layout tree per size class, by window width: compact < 600 dp, medium 600-839, expanded 840 and over. */
const ScreenShape = v.strictObject({ compact: NodeShape, medium: v.optional(NodeShape), expanded: v.optional(NodeShape) });

const Schema = v.strictObject({
  schemaVersion: v.literal(2),
  navigation: v.array(NavItem),
  tokens: v.record(Text, v.union([v.string(), v.number()])),
  switches: v.record(Text, v.boolean()),
  copy: v.strictObject({ en: Lines, id: Lines, th: Lines, vi: Lines, zh: Lines }),
  screens: v.record(Text, ScreenShape),
});
export type UiDocument = v.InferOutput<typeof Schema>;

export function validateUiDocument(input: unknown): { ok: true; doc: UiDocument } | { ok: false; errors: string[] } {
  const parsed = v.safeParse(Schema, input);
  if (!parsed.success) return { ok: false, errors: parsed.issues.map((issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`) };
  const doc = parsed.output;
  const errors = [...copyErrors(doc), ...requiredCopyErrors(doc), ...navigationErrors(doc), ...screenErrors(doc), ...tokenErrors(doc)];
  return errors.length ? { ok: false, errors } : { ok: true, doc };
}

/** Each language's copy lists exactly English's keys. */
function copyErrors(doc: UiDocument): string[] {
  const errors: string[] = [];
  const english = Object.keys(doc.copy.en);
  for (const locale of LOCALES) {
    for (const key of english) if (!Object.hasOwn(doc.copy[locale], key)) errors.push(`copy.${locale} is missing ${key}`);
    for (const key of Object.keys(doc.copy[locale]))
      if (!english.includes(key)) errors.push(`copy.${locale} has ${key}, which English lacks`);
  }
  return errors;
}

/** Each menu item is listed once, names a menu route that is not sealed, and labels itself with a copy key. */
function navigationErrors(doc: UiDocument): string[] {
  const errors: string[] = [];
  const english = Object.keys(doc.copy.en);
  const ids = new Set<string>();
  for (const item of doc.navigation) {
    if (ids.has(item.id)) errors.push(`navigation ${item.id} is listed twice`);
    ids.add(item.id);
    if (SEALED_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names sealed route ${item.route}`);
    else if (!MENU_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names route ${item.route}, which is not a menu route`);
    else if (!Object.hasOwn(doc.screens, item.route)) errors.push(`navigation ${item.id} names route ${item.route}, which has no screen`);
    if (!english.includes(item.label)) errors.push(`navigation ${item.id} label ${item.label} is not a copy key`);
  }
  return errors;
}

/** English carries every line the sealed update screen shows; copyErrors holds the other languages to English. */
function requiredCopyErrors(doc: UiDocument): string[] {
  return REQUIRED_COPY.filter((key) => !Object.hasOwn(doc.copy.en, key)).map(
    (key) => `copy.en is missing ${key}, which the sealed update screen needs`,
  );
}

/** Every colour token is #RRGGBB, and each text-and-background pair reaches 4.5:1. */
function tokenErrors(doc: UiDocument): string[] {
  const errors: string[] = [];
  const colours = new Map<string, string>();
  for (const [name, value] of Object.entries(doc.tokens)) {
    if (!name.startsWith('color.')) continue;
    if (typeof value === 'string' && isHexColour(value)) colours.set(name, value);
    else errors.push(`tokens: ${name} must be #RRGGBB`);
  }
  for (const [foreground, background] of CONTRAST_PAIRS) {
    const [fg, bg] = [colours.get(foreground), colours.get(background)];
    if (fg === undefined || bg === undefined) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5) errors.push(`tokens: ${foreground} on ${background} contrast ${ratio.toFixed(1)}:1 is under 4.5:1`);
  }
  return errors;
}

/** Each screen sits under a screen route that is not sealed, and each of its trees passes the catalogue. */
function screenErrors(doc: UiDocument): string[] {
  const errors: string[] = [];
  for (const [route, screen] of Object.entries(doc.screens)) {
    if (SEALED_ROUTES.includes(route)) errors.push(`screens.${route}: ${route} is sealed, so the server never draws it`);
    else if (!SCREEN_ROUTES.includes(route)) errors.push(`screens.${route}: ${route} is not a screen route`);
    else
      for (const size of ['compact', 'medium', 'expanded'] as const) {
        const tree = screen[size];
        if (tree) walk(tree, { where: `screens.${route}.${size}`, doc, ids: new Set(), errors });
      }
  }
  return errors;
}

interface Walk {
  where: string;
  doc: UiDocument;
  ids: Set<string>;
  errors: string[];
}

/** Token names look like `size.m`; anything else where a token is due is a raw value. */
const TOKEN_NAME = /^[a-z]+\.[A-Za-z0-9.]+$/;

function walk(node: Node, at: Walk): void {
  const fail = (message: string): void => {
    at.errors.push(`${at.where}: ${message}`);
  };
  if (at.ids.has(node.id)) fail(`node id ${node.id} is used twice`);
  at.ids.add(node.id);
  if ('block' in node) {
    if (!BLOCKS.includes(node.block)) fail(`block ${node.block} is not a native block`);
    return;
  }
  if (!(PARTS as readonly string[]).includes(node.part)) {
    fail(`part ${node.part} is not in the catalogue`);
    return;
  }
  const part = node.part as Part;
  const props = node.props ?? {};
  for (const [name, value] of Object.entries(props)) {
    const kind = PART_PROPS[part][name];
    if (kind === undefined) fail(`${part} takes no prop ${name}`);
    else propErrors(part, name, kind, value, at, fail);
  }
  if (part === 'text' && props['copy'] === undefined && props['bind'] === undefined)
    fail(`text ${node.id} names neither copy nor a binding`);
  for (const child of node.children ?? []) walk(child, at);
}

function propErrors(
  part: Part,
  name: string,
  kind: (typeof PART_PROPS)[Part][string],
  value: string | number | boolean | Action,
  at: Walk,
  fail: (message: string) => void,
): void {
  if (kind === 'action') {
    if (typeof value !== 'object') fail(`${part} ${name} must be an action`);
    else actionErrors(value, at, fail);
    return;
  }
  if (typeof value !== 'string') {
    fail(kind === 'token' ? `${name} must name a token` : `${part} ${name} must be text`);
    return;
  }
  if (kind === 'token') {
    if (Object.hasOwn(at.doc.tokens, value)) return;
    fail(TOKEN_NAME.test(value) ? `token ${value} is missing` : `${name} must name a token`);
  } else if (kind === 'copy') {
    if (!Object.hasOwn(at.doc.copy.en, value)) fail(`copy key ${value} is missing`);
  } else if (kind === 'binding') {
    if (!(BINDINGS as readonly string[]).includes(value)) fail(`binding ${value} is not in the catalogue`);
  } else if (kind === 'asset') {
    if (!ASSETS.includes(value)) fail(`image asset ${value} is not shipped in the app`);
  } else if (!kind.includes(value)) fail(`${part} ${name} ${value} is not one of ${kind.join(', ')}`);
}

function actionErrors(action: Action, at: Walk, fail: (message: string) => void): void {
  if (!(ACTIONS as readonly string[]).includes(action.do)) {
    fail(`action ${action.do} is not in the catalogue`);
    return;
  }
  if (action.do === 'openRoute' || action.do === 'openSheet') {
    if (action.route === undefined || !Object.hasOwn(at.doc.screens, action.route))
      fail(`${action.do} names route ${action.route ?? '(none)'}, which has no screen`);
  }
}
