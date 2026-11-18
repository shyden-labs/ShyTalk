/**
 * What the smoke suite and its iPhone copy share to check the holding page's look (shyden-labs/ShyTalk#273): one
 * check, run inside the browser, that measures the icon, the page's width, the hello bubbles, their motion and the
 * brand fonts, and what each should be at a given width.
 */
import { HELLOS } from '../../apps/web/src/brand.ts';

/** The widest page that counts as a phone: it shows five hellos, a wider one all seven. */
export const PHONE_WIDTH = 600;

/** The width the smoke sets for the phone step where its browser can take one (a desktop browser). */
export const NARROW_WIDTH = 360;

/** Each brand font and a word it must draw. */
export const BRAND_FONTS: readonly [font: string, text: string][] = [
  ['500 18px "Outfit"', 'ShyTalk'],
  ['800 18px "Outfit"', 'ShyTalk'],
  ['800 18px "Noto Sans"', 'xin chào'],
  ['800 18px "Noto Sans SC"', '你好'],
  ['800 18px "Noto Sans Thai"', 'สวัสดี'],
];

export interface HoldingFacts {
  /** The page's own width, `innerWidth`. */
  width: number;
  /** Whether the visitor asked for reduced motion. */
  reducedMotion: boolean;
  /** The large icon loaded, with a size of its own. */
  iconLoaded: boolean;
  /** Nothing scrolls sideways. */
  fits: boolean;
  /** The words of the bubbles shown, in order. */
  shown: string[];
  /** Every bubble shown lies inside the bubbles' stage. */
  inside: boolean;
  /** The words of the bubbles shown that move. */
  moving: string[];
  /** Each brand font, by its CSS `font`, and whether a face of its own draws its word. */
  fonts: Record<string, boolean>;
}

/** The hello words the page should show at `width`. */
export function wantedHellos(width: number): string[] {
  return HELLOS.slice(0, width <= PHONE_WIDTH ? 5 : HELLOS.length).map(({ word }) => word);
}

/** What the page's facts should be: the hellos for its width, all moving unless reduced motion stills them. */
export function wantedFacts(width: number, reducedMotion: boolean): HoldingFacts {
  const shown = wantedHellos(width);
  return {
    width,
    reducedMotion,
    iconLoaded: true,
    fits: true,
    shown,
    inside: true,
    moving: reducedMotion ? [] : shown,
    fonts: Object.fromEntries(BRAND_FONTS.map(([font]) => [font, true])),
  };
}

/**
 * A function's source, run in the browser with BRAND_FONTS: text, as Playwright and WebDriver each send a script's
 * text to the browser; written for every browser the suite runs in.
 */
export const HOLDING_FACTS = `async (brandFonts) => {
  await document.fonts.ready;
  const icon = document.querySelector('img.brand-icon');
  if (icon !== null) await icon.decode().catch(() => undefined);
  const stage = document.querySelector('ul.hellos');
  const box = stage === null ? null : stage.getBoundingClientRect();
  const shown = [];
  const moving = [];
  let inside = box !== null;
  for (const bubble of document.querySelectorAll('ul.hellos > li')) {
    const style = getComputedStyle(bubble);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const word = bubble.textContent.trim();
    shown.push(word);
    if (style.animationName !== 'none') moving.push(word);
    const rect = bubble.getBoundingClientRect();
    inside = inside && rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
  }
  const fonts = {};
  for (const [font, text] of brandFonts) {
    fonts[font] = (await document.fonts.load(font, text)).length > 0;
  }
  const root = document.documentElement;
  return {
    width: innerWidth,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    iconLoaded: icon !== null && icon.complete && icon.naturalWidth > 0,
    fits: root.scrollWidth <= root.clientWidth,
    shown,
    inside,
    moving,
    fonts,
  };
}`;
