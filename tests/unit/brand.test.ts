/**
 * ShyTalk's brand (shyden-labs/ShyTalk#273), as Shyden approved it on 2026-11-18
 * (docs/superpowers/specs/2026-11-18-shytalk-brand-and-holding-page-design.md):
 * the colour tokens, the icon's three hello bubbles, the wordmark, and the seven
 * hellos the holding page floats, each readable on its bubble.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAND, HELLOS, ICON_BUBBLES } from '../../apps/web/src/brand.ts';

const ICON = readFileSync(new URL('../../brand/icon.svg', import.meta.url), 'utf8');
const WORDMARK = readFileSync(new URL('../../brand/wordmark.svg', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('ShyTalk brand', () => {
  it('has exactly the approved colours', () => {
    expect(BRAND).toEqual({
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
    });
  });

  it("has the icon's three bubbles, top to bottom", () => {
    expect(ICON_BUBBLES).toEqual([
      { word: 'hello', lang: 'en', fill: '#ffb020', text: '#2a1600' },
      { word: '你好', lang: 'zh-Hans', fill: '#ff5c8a', text: '#ffffff' },
      { word: 'สวัสดี', lang: 'th', fill: '#20c4b0', text: '#08332e' },
    ]);
  });

  it('draws the icon on its tile with each bubble in order', () => {
    expect(ICON).toContain('viewBox="0 0 120 120"');
    expect(ICON).toMatch(new RegExp(`<rect[^>]*rx="27"[^>]*fill="${BRAND.tile}"`));
    let from = ICON.indexOf('<rect');
    for (const bubble of ICON_BUBBLES) {
      const fill = ICON.indexOf(`fill="${bubble.fill}"`, from);
      expect(fill, `${bubble.word}'s bubble`).toBeGreaterThan(from);
      from = fill;
    }
    for (const bubble of ICON_BUBBLES) {
      const word = ICON.indexOf(`fill="${bubble.text}"`, from);
      expect(word, `${bubble.word}'s text colour`).toBeGreaterThan(from);
      expect(ICON.indexOf(`>${bubble.word}</text>`, word), `${bubble.word}'s word`).toBeGreaterThan(word);
      from = word;
    }
  });

  it('writes the wordmark in white and violet', () => {
    expect(WORDMARK).toMatch(/fill="#ffffff"[^>]*>Shy</);
    expect(WORDMARK).toMatch(new RegExp(`fill="${BRAND.violet}"[^>]*>Talk<`));
  });

  it('has the seven hellos in order, never translated', () => {
    expect(HELLOS.map(({ word, lang }) => [word, lang])).toEqual([
      ['hello', 'en'],
      ['こんにちは', 'ja'],
      ['halo', 'id'],
      ['xin chào', 'vi'],
      ['สวัสดี', 'th'],
      ['你好', 'zh-Hans'],
      ['hola', 'es'],
    ]);
    expect(HELLOS.map(({ fill }) => fill)).toEqual([
      BRAND.yellow,
      BRAND.pink,
      BRAND.teal,
      BRAND.violet,
      BRAND.blue,
      BRAND.gold,
      BRAND.green,
    ]);
    expect(HELLOS[1]?.text).toBe(BRAND.plum);
  });

  for (const hello of HELLOS) {
    it(`reads "${hello.word}" at 4.5:1 or more on its bubble`, () => {
      expect(contrast(hello.text, hello.fill)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
