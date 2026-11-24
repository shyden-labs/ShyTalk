/**
 * The language menu every page shows (shyden-labs/ShyTalk#332), the same as shyden.co.uk's: one button with the
 * current language's flag, its own name (a short name below 720px), BETA when the language is machine-translated, and
 * a caret; it opens a list of every language with its flag and own name, a tick on the current one, BETA on each
 * machine-translated one, and every other language a link to the same page in that language.
 *
 * Both checks are text, as Playwright and WebDriver each send a script's text to the browser, so the smoke suite and
 * its iPhone copy run the same check. `MENU_STRUCTURE` reads a document (a fetched page's, or the open one);
 * `MENU_LIVE` reads the open page as it is drawn.
 */
import { LANGUAGE_NAMES, LOCALES, langTag, localePath, t, type Locale } from '../../apps/web/src/i18n/t.ts';
import { LEGAL_DOCS, legalPath, type LegalDoc } from '../../apps/web/src/legal/legal.ts';

/** Below this width the button shows the short name; from it, the full name (shyden.co.uk's own breakpoint). */
export const FULL_NAME_WIDTH = 720;

/** The smallest touch target, in CSS pixels. */
export const TARGET_HEIGHT = 44;

/** Each language's short name, shown below 720px: Chinese and Thai are their own short forms (shyden.co.uk's table). */
export const SHORT_NAMES: Record<Locale, string> = { en: 'EN', id: 'ID', th: 'ไทย', vi: 'VI', zh: '中文' };

/** Each language's flag, as its `data-flag`: British copy, and the PRC flag for simplified Chinese (as shyden.co.uk). */
export const FLAGS: Record<Locale, string> = { en: 'gb', id: 'id', th: 'th', vi: 'vn', zh: 'cn' };

/** A flag as the check reads it: its name, then the attributes that keep it out of the accessible name. */
const flag = (locale: Locale): string => `${FLAGS[locale]} 0 0 24 16 true presentation false`;

export interface MenuBeta {
  /** The badge's own text: "BETA", never translated. */
  shown: string;
  /** The visually hidden words after it, in the page's language. */
  hidden: string | null;
  lang: string | null;
}

export interface MenuEntry {
  current: string | null;
  /** href, hreflang, lang and rel of the entry's link; null for the current language, which links nowhere. */
  link: (string | null)[] | null;
  flag: string | null;
  name: string | null;
  beta: MenuBeta | null;
  tick: boolean;
}

export interface MenuStructure {
  /** How many menus the page holds: one. The rest is read only when there is one. */
  count: number;
  /** The button's own aria-label: none, so its accessible name holds the language it shows (WCAG 2.5.3, axe). */
  ariaLabel?: string | null;
  /** The visually hidden word that names the button for a screen reader, before the language it shows. */
  label?: string | null;
  flag?: string | null;
  full?: string | null;
  short?: string | null;
  beta?: MenuBeta | null;
  caret?: string | null;
  entries?: MenuEntry[];
}

/** The menu's parts in a document `doc`, read from its markup (no styles, no scripts). */
export const MENU_STRUCTURE = `(doc) => {
  const menus = doc.querySelectorAll('details.lang-switch');
  if (menus.length !== 1) return { count: menus.length };
  const menu = menus[0];
  const flag = (svg) =>
    svg === null
      ? null
      : [svg.getAttribute('data-flag'), svg.getAttribute('viewBox'), svg.getAttribute('aria-hidden'), svg.getAttribute('role'), svg.getAttribute('focusable')].join(' ');
  const text = (element) => (element === null ? null : element.textContent);
  const beta = (element) => {
    if (element === null) return null;
    const hidden = element.querySelector('.visually-hidden');
    return { shown: element.firstChild === null ? '' : element.firstChild.textContent, hidden: text(hidden), lang: hidden === null ? null : hidden.getAttribute('lang') };
  };
  const summary = menu.querySelector(':scope > summary');
  if (summary === null) return { count: 1, ariaLabel: null, label: null };
  const caret = summary.querySelector('.caret');
  const entries = [...menu.querySelectorAll(':scope > ul > li')].map((li) => {
    const link = li.querySelector(':scope > a.entry');
    const entry = link || li.querySelector(':scope > span.entry') || li;
    return {
      current: li.getAttribute('aria-current'),
      link: link === null ? null : ['href', 'hreflang', 'lang', 'rel'].map((name) => link.getAttribute(name)),
      flag: flag(entry.querySelector('svg.flag')),
      name: text(entry.querySelector('.name')),
      beta: beta(entry.querySelector('.beta')),
      tick: entry.querySelector('.tick[aria-hidden="true"]') !== null,
    };
  });
  return {
    count: 1,
    ariaLabel: summary.getAttribute('aria-label'),
    label: text(summary.querySelector(':scope > .label.visually-hidden')),
    flag: flag(summary.querySelector(':scope > svg.flag')),
    full: text(summary.querySelector(':scope > .name.full')),
    short: text(summary.querySelector(':scope > .name.short')),
    beta: beta(summary.querySelector(':scope > .beta')),
    caret: caret === null ? null : caret.getAttribute('aria-hidden'),
    entries,
  };
}`;

/** The BETA badge a language carries on a page in `page`'s language: every language but English is machine-translated. */
function betaOf(locale: Locale, page: Locale): MenuBeta | null {
  return locale === 'en' ? null : { shown: 'BETA', hidden: ` — ${t(page, 'language.beta')}`, lang: langTag(page) };
}

/** The menu a page in `locale` should hold, `href(other)` being the address of the same page in `other`. */
export function wantedMenu(locale: Locale, href: (other: Locale) => string): MenuStructure {
  return {
    count: 1,
    ariaLabel: null,
    label: t(locale, 'language.label'),
    flag: flag(locale),
    full: LANGUAGE_NAMES[locale],
    short: SHORT_NAMES[locale],
    beta: betaOf(locale, locale),
    caret: 'true',
    entries: LOCALES.map((other) => ({
      current: other === locale ? 'true' : null,
      link: other === locale ? null : [href(other), langTag(other), langTag(other), 'alternate'],
      flag: flag(other),
      name: LANGUAGE_NAMES[other],
      beta: betaOf(other, locale),
      tick: other === locale,
    })),
  };
}

/**
 * The address of the built page at `path` (as `pagePath` names it, e.g. `/th/support.html`) in `other`: the holding
 * page and the not-found page lead to each language's home, a legal page to its own text in that language (English
 * with the language's note where it has none), any other page to the same page under that language's prefix.
 */
export function samePageIn(path: string, other: Locale): string {
  const unprefixed = path.replace(new RegExp(`^/(${LOCALES.join('|')})(?=/)`), '').replace(/\.html$/, '');
  if (unprefixed === '/holding') return `/${other}/`;
  if (unprefixed === '/404') return localePath(other, '/');
  const doc = LEGAL_DOCS.find((name: LegalDoc) => unprefixed === `/${name}`);
  return doc === undefined ? localePath(other, unprefixed) : legalPath(other, doc);
}

export interface MenuLive {
  open: boolean;
  /** Whether the list of languages is drawn. */
  listShown: boolean;
  /** The names the button draws: one, short or full by width. */
  names: string[];
  flagShown: boolean;
  /** The button, and each entry while the list is drawn, at least 44px tall; null for the entries while it is shut. */
  summaryTall: boolean;
  entriesTall: boolean | null;
  /** Nothing pushes the page sideways. */
  noSideScroll: boolean;
  width: number;
}

/** The menu as the open page draws it. */
export const MENU_LIVE = `() => {
  const menu = document.querySelector('details.lang-switch');
  if (menu === null) return { open: false, listShown: false, names: [], flagShown: false, summaryTall: false, entriesTall: null, noSideScroll: false, width: window.innerWidth };
  const shown = (element) => element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const summary = menu.querySelector(':scope > summary');
  const list = menu.querySelector(':scope > ul');
  const listShown = shown(list);
  return {
    open: menu.open,
    listShown,
    names: [...summary.querySelectorAll(':scope > .name')].filter(shown).map((name) => name.textContent),
    flagShown: shown(summary.querySelector(':scope > svg.flag')),
    summaryTall: summary.getBoundingClientRect().height >= ${String(TARGET_HEIGHT)},
    entriesTall: listShown ? [...list.querySelectorAll('.entry')].every((entry) => entry.getBoundingClientRect().height >= ${String(TARGET_HEIGHT)}) : null,
    noSideScroll: document.documentElement.scrollWidth <= window.innerWidth,
    width: window.innerWidth,
  };
}`;

/** The menu a page in `locale`, `width` wide, should draw, open or shut. */
export function wantedLive(locale: Locale, width: number, open: boolean): MenuLive {
  return {
    open,
    listShown: open,
    names: [width < FULL_NAME_WIDTH ? SHORT_NAMES[locale] : LANGUAGE_NAMES[locale]],
    flagShown: true,
    summaryTall: true,
    entriesTall: open ? true : null,
    noSideScroll: true,
    width,
  };
}

/** The language after `locale` in the menu's order, the one each journey picks. */
export const nextLocale = (locale: Locale): Locale => LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length] as Locale;
