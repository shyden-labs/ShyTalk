/**
 * WCAG 2.2 contrast between two `#RRGGBB` colours (plan 6.1 Task 2): the
 * relative luminance of the lighter plus 0.05, over the darker's plus 0.05,
 * from 1 (the same colour) to 21 (black on white).
 */
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** True when `colour` is `#RRGGBB`, the only form a colour token takes. */
export const isHexColour = (colour: string): boolean => HEX.test(colour);

function luminance(colour: string): number {
  if (!isHexColour(colour)) throw new Error(`contrastRatio: ${colour} is not #RRGGBB`);
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(colour.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
