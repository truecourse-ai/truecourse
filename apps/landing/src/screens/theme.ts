/**
 * The dashboard's light palette, as the screens draw it: the same greys the app
 * paints and the same five status colours its dots wear.
 */
export const ui = {
  bg: '#ffffff',
  card: '#fafafa',
  soft: '#f3f4f6',
  activeRow: '#ececec',
  fg: '#1a1a1a',
  muted: '#6b6b6b',
  faint: '#9a9a9a',
  line: '#e6e6e6',
  primary: '#1a1a1a',
  onPrimary: '#fafafa',
  link: '#0969da',
  emerald: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  slate: '#94a3b8',
  /** The failure red at a tint: the one requirement the story follows, wherever it is quoted. */
  failTint: '#f9d2d2',
} as const;

/**
 * The height every desktop screen draws at. They share one canvas so the
 * steps line up wherever they are placed, and each screen's chrome (the
 * sidebar, the dividers, the tally at the foot) fills it.
 */
export const SCREEN_H = 580;

export type Tone = 'success' | 'failure' | 'blocked' | 'unproven' | 'neutral';

export const TONE: Record<Tone, string> = {
  success: ui.emerald,
  failure: ui.red,
  blocked: ui.amber,
  unproven: ui.sky,
  neutral: ui.slate,
};

/** JetBrains Mono's advance width, in em. */
const CHAR = 0.6;

export function textWidth(text: string, size: number): number {
  return text.length * size * CHAR;
}

/**
 * The product's sans, one advance per character in tenths of a percent of an
 * em, measured in Chromium on the `--font-ui` stack: printable ASCII in order
 * and then the three marks the screens use (a curly apostrophe, a single
 * guillemet, a middle dot). The system face changes shape with its optical
 * size, so there is one table for UI text (13px) and one for a title (32px),
 * each at the regular and the semibold weight.
 */
const UI_CHARS = 95 + 3;
const UI_TEXT_400 = [27.5, 30.5, 47.2, 62.4, 62.4, 91.9, 70.6, 29.1, 37.6, 37.6, 46.6, 62.4, 29.1, 46.6, 29.1, 29.9, 62.4, 45.8, 59.8, 62.1, 63.8, 61.2, 63.1, 56.3, 63.3, 63.1, 29.1, 29.1, 62.4, 62.4, 62.4, 50.7, 91.2, 66.8, 65.1, 71, 72.1, 59, 56.6, 74.1, 73.6, 26.2, 53.2, 65.3, 56.2, 86.8, 73.6, 76.6, 62.9, 76.6, 64.7, 63.1, 62.8, 73.1, 66.8, 96.2, 67.3, 64.9, 65.6, 37.6, 29.9, 37.6, 62.4, 57.8, 49.4, 54.6, 60.8, 55.4, 60.8, 56.5, 35.6, 60.4, 58.3, 24.1, 24.1, 53.7, 24.7, 86.4, 57.8, 58.5, 60.4, 60.4, 37.5, 51.8, 35.7, 57.8, 53.6, 76.9, 51.9, 53.7, 53.3, 37.6, 25.3, 37.6, 62.4, 29.1, 43.9, 29.1];
const UI_TEXT_600 = [26, 33.5, 53.3, 65.2, 65.2, 99.3, 72.8, 32.5, 40.7, 40.7, 47.4, 65.2, 32.5, 47.4, 32.5, 31.9, 66.1, 49, 62.4, 64.9, 66.7, 64.3, 66.2, 58.7, 66.9, 66.2, 32.5, 32.5, 65.2, 65.2, 65.2, 53.7, 91.8, 70.7, 67.5, 72.7, 73.4, 60.7, 58.3, 75, 76.4, 29.5, 57.4, 68.7, 58, 89, 75.3, 77.5, 65.5, 77.5, 67.5, 65.7, 64.6, 74.7, 70, 99, 70.7, 68.5, 66.5, 40.7, 31.9, 40.7, 65.2, 60.7, 49.4, 57.1, 63.3, 57.2, 63.3, 58.5, 38.7, 62.7, 61.2, 26.8, 26.8, 57.6, 27.5, 90.6, 60.7, 60.4, 62.9, 62.9, 41.1, 54.6, 39, 60.7, 56.3, 81.7, 55.6, 57.3, 55.1, 40.7, 28, 40.7, 65.2, 32.5, 44.7, 32.5];
const UI_TITLE_400 = [21.8, 27.9, 41.6, 61.7, 61.7, 82.1, 68.2, 26.7, 33.5, 33.5, 41.3, 61.7, 22.8, 44.1, 22.8, 29.2, 61.9, 45.6, 57.9, 60.4, 61.7, 59.8, 63, 56, 61.2, 63, 22.8, 22.8, 61.7, 61.7, 61.7, 50.2, 88.7, 64.8, 61.7, 69.9, 69.1, 56.5, 54.1, 71.9, 71.2, 23.7, 50.8, 61.3, 53.7, 84.4, 71.2, 74.4, 59, 74.4, 61.2, 60.6, 59.4, 70.9, 64.4, 93.7, 64.7, 62.5, 62.9, 33.5, 29.2, 33.5, 61.7, 54, 51.3, 51.5, 56.6, 51.4, 56.6, 52.5, 31.6, 56.2, 55.2, 21.9, 21.8, 49.8, 21.7, 81.6, 54, 54.3, 56.2, 56.2, 32.1, 47.8, 31.4, 54, 49.6, 72.8, 48.1, 49.9, 48, 33.5, 22.9, 33.5, 61.7, 22.8, 41.5, 22.8];
const UI_TITLE_600 = [21.3, 31.3, 45.1, 64, 64.6, 87.5, 70.4, 27.7, 37.5, 37.5, 44.6, 64.6, 24.5, 45, 24.5, 30.8, 65.2, 48, 60.4, 63, 64.6, 62.5, 65.3, 57.6, 64.5, 65.3, 24.5, 24.5, 64.6, 64.6, 64.6, 53.2, 89.6, 68.6, 64.1, 71.6, 70.6, 57.9, 55.4, 73.3, 73.2, 26.4, 55, 64.8, 54.9, 86.4, 72.2, 75.8, 61.7, 75.8, 63.9, 63.1, 60.7, 71.6, 67.5, 96.4, 68.1, 66, 63.9, 37.5, 30.8, 37.5, 64.6, 57.2, 51.3, 54.5, 59.5, 54.3, 59.4, 55.3, 35.1, 59.1, 58.2, 24.2, 24.1, 53.3, 24.2, 85.6, 57.2, 57.1, 59.1, 59.1, 35.8, 51.1, 35, 57.2, 52.6, 77.8, 52.1, 53.4, 50.5, 37.5, 24.6, 37.5, 64.6, 24.5, 42.3, 24.5];
const UI_MARKS = '\u2019\u203a\u00b7';

function uiIndex(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code < 127) return code - 32;
  const mark = UI_MARKS.indexOf(ch);
  return mark >= 0 ? 95 + mark : -1;
}

/** The width of text set in `--font-ui`, at the regular or the semibold face. */
export function uiWidth(text: string, size: number, weight: 400 | 500 | 600 = 400): number {
  const title = size > 20;
  const regular = title ? UI_TITLE_400 : UI_TEXT_400;
  const semibold = title ? UI_TITLE_600 : UI_TEXT_600;
  let em = 0;
  for (const ch of text) {
    const i = uiIndex(ch);
    const w400 = i >= 0 && i < UI_CHARS ? regular[i]! : 52;
    const w600 = i >= 0 && i < UI_CHARS ? semibold[i]! : 55;
    em += weight === 600 ? w600 : weight === 500 ? (w400 + w600) / 2 : w400;
  }
  return (em / 100) * size;
}

/** The baseline that centres a line of `size` text on `cy`. */
export function baseline(cy: number, size: number): number {
  return cy + size * 0.36;
}

/** How far the product's sans reaches above and below its baseline, in em. */
export const UI_ASCENT = 0.76;
export const UI_DESCENT = 0.22;
