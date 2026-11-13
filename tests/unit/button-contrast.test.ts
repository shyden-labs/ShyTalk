/**
 * Every website button is readable on iPhone Safari (shyden-labs/ShyTalk#186):
 * with no colours of its own, a button took Safari's default white on #0091ff
 * (3.23:1, measured on the iPhone Air 2026-11-13). The site's stylesheet gives
 * every button its text and background from the site's tokens, and each pair
 * reaches 4.5:1 in the light and the dark scheme.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** site.css with its comments taken out, so a comment never hides a selector. */
const CSS = readFileSync(new URL('../../apps/web/public/styles/site.css', import.meta.url), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties set in a block of declarations, by name. */
function tokens(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, name, value]) => [name ?? '', value ?? '']));
}

/** The declarations of the rule whose selector list names `button` alone. */
function buttonRule(css: string): string | undefined {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((selectors ?? '').split(',').some((selector) => selector.trim() === 'button')) return body;
  }
  return undefined;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the website buttons', () => {
  it('take their text and background from the site tokens, at 4.5:1 or more in both schemes', () => {
    const rule = buttonRule(CSS);
    expect(rule, 'site.css has a rule for `button`').toBeDefined();
    const text = /(?:^|;)\s*color:\s*var\((--[a-z-]+)\)/.exec(rule ?? '')?.[1];
    const fill = /background(?:-color)?:\s*var\((--[a-z-]+)\)/.exec(rule ?? '')?.[1];
    expect(text, 'the button rule sets `color` from a token').toBeDefined();
    expect(fill, 'the button rule sets `background` from a token').toBeDefined();

    const light = tokens(/:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '');
    const dark = new Map([...light, ...tokens(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '')]);
    for (const [scheme, set] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const pair = [set.get(text ?? ''), set.get(fill ?? '')];
      expect(
        pair.every((value) => value !== undefined),
        `both tokens are set in the ${scheme} scheme`,
      ).toBe(true);
      expect(ratio(pair[0] ?? '', pair[1] ?? ''), `${scheme} scheme contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
