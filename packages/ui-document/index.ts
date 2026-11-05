/**
 * The app's UI document: menus, colours, sizes, switches and words, sent by
 * the server (plan 4 Task 5, shyden-labs/ShyTalk#78; live-app design D6).
 * `validateUiDocument` is the only way a document is accepted for publishing.
 */
import * as v from 'valibot';

export const LOCALES = ['en', 'id', 'th', 'vi', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The routes a menu may link to. Anything else is refused, whatever its name,
 * so a server-controlled screen cannot reach a menu under a name nobody
 * listed. A new menu route is added here, in reviewed code, never by editing
 * the document. Grows with the app's screens (plan 6).
 */
export const MENU_ROUTES: readonly string[] = ['rooms'];

/**
 * Screens the server alone opens (ban and suspension, App-Lock, cohort
 * segregation, unsafe device, account deletion): never a menu route, held
 * apart by a test, and named in the refusal when a document tries one.
 */
export const SEALED_ROUTES: readonly string[] = ['ban', 'suspension', 'app-lock', 'cohort', 'unsafe-device', 'delete-account'];

const Text = v.pipe(v.string(), v.minLength(1));
const Lines = v.record(Text, Text);
const NavItem = v.strictObject({
  id: Text,
  route: Text,
  /** A copy key, so every menu label is translated. */
  label: Text,
});
const Schema = v.strictObject({
  schemaVersion: v.literal(1),
  navigation: v.array(NavItem),
  tokens: v.record(Text, v.union([v.string(), v.number()])),
  switches: v.record(Text, v.boolean()),
  copy: v.strictObject({ en: Lines, id: Lines, th: Lines, vi: Lines, zh: Lines }),
  // `screens` is reserved for Part 2 (live-app D6): a strict object refuses it until then.
});
export type UiDocument = v.InferOutput<typeof Schema>;

export function validateUiDocument(input: unknown): { ok: true; doc: UiDocument } | { ok: false; errors: string[] } {
  const parsed = v.safeParse(Schema, input);
  if (!parsed.success) return { ok: false, errors: parsed.issues.map((issue) => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`) };
  const doc = parsed.output;
  const errors: string[] = [];
  const english = Object.keys(doc.copy.en);

  for (const locale of LOCALES) {
    for (const key of english) if (!Object.hasOwn(doc.copy[locale], key)) errors.push(`copy.${locale} is missing ${key}`);
    for (const key of Object.keys(doc.copy[locale]))
      if (!english.includes(key)) errors.push(`copy.${locale} has ${key}, which English lacks`);
  }

  const ids = new Set<string>();
  for (const item of doc.navigation) {
    if (ids.has(item.id)) errors.push(`navigation ${item.id} is listed twice`);
    ids.add(item.id);
    if (SEALED_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names sealed route ${item.route}`);
    else if (!MENU_ROUTES.includes(item.route)) errors.push(`navigation ${item.id} names route ${item.route}, which is not a menu route`);
    if (!english.includes(item.label)) errors.push(`navigation ${item.id} label ${item.label} is not a copy key`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, doc };
}
