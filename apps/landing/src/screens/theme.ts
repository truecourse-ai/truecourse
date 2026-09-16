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
  /** The site accent at a tint: the one requirement, wherever the story shows it. */
  highlight: '#dcefe5',
} as const;

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

/** The baseline that centres a line of `size` text on `cy`. */
export function baseline(cy: number, size: number): number {
  return cy + size * 0.36;
}
