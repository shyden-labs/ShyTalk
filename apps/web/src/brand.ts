/**
 * ShyTalk's brand tokens (shyden-labs/ShyTalk#273): the colours, the icon's three
 * hello bubbles and the seven hellos the holding page floats. brand/README.md says
 * how to use them; the hellos are never translated.
 */
export const BRAND = {
  night: '#16123a',
  tile: '#211a52',
  violet: '#a78bfa',
  inkSoft: '#ddd8ff',
  muted: '#a9a2d6',
  yellow: '#ffb020',
  pink: '#ff5c8a',
  teal: '#20c4b0',
  blue: '#60a5fa',
  gold: '#fbbf24',
  green: '#34d399',
  plum: '#2a0614',
} as const;

/** A hello word in its language, on a bubble of `fill`, written in `text`. */
export interface Hello {
  readonly word: string;
  readonly lang: string;
  readonly fill: string;
  readonly text: string;
}

/** The icon's bubbles, top to bottom (brand/icon.svg draws them). */
export const ICON_BUBBLES: readonly Hello[] = [
  { word: 'hello', lang: 'en', fill: BRAND.yellow, text: '#2a1600' },
  { word: '你好', lang: 'zh-Hans', fill: BRAND.pink, text: '#ffffff' },
  { word: 'สวัสดี', lang: 'th', fill: BRAND.teal, text: '#08332e' },
];

/** The holding page's hellos, in order; a phone shows the first five. */
export const HELLOS: readonly Hello[] = [
  { word: 'hello', lang: 'en', fill: BRAND.yellow, text: '#2a1600' },
  { word: 'こんにちは', lang: 'ja', fill: BRAND.pink, text: BRAND.plum },
  { word: 'halo', lang: 'id', fill: BRAND.teal, text: '#08332e' },
  { word: 'xin chào', lang: 'vi', fill: BRAND.violet, text: BRAND.night },
  { word: 'สวัสดี', lang: 'th', fill: BRAND.blue, text: '#0b2244' },
  { word: '你好', lang: 'zh-Hans', fill: BRAND.gold, text: '#2a1600' },
  { word: 'hola', lang: 'es', fill: BRAND.green, text: '#06281c' },
];
