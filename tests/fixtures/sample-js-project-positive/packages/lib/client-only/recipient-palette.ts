
// FP: colord and AVAILABLE_COLORS are imported constants used in a `once()`-wrapped function.
// ES imports are hoisted; the analyzer incorrectly treats them as use-before-define.
declare function once<T>(fn: () => T): () => T;
declare function colord(color: string): { toHsl: () => { h: number; s: number; l: number } };

const AVAILABLE_PALETTE_COLORS = ['#4A90E2', '#7ED321', '#D0021B', '#F5A623', '#9B59B6'] as const;
type PaletteColor = typeof AVAILABLE_PALETTE_COLORS[number];

type ColorStyles = {
  base: string;
  text: string;
  border: string;
};

const RECIPIENT_COLOR_STYLES: Record<PaletteColor, () => ColorStyles> = {
  '#4A90E2': once((): ColorStyles => ({ base: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-500' })),
  '#7ED321': once((): ColorStyles => ({ base: 'bg-green-100', text: 'text-green-700', border: 'border-green-500' })),
  '#D0021B': once((): ColorStyles => ({ base: 'bg-red-100', text: 'text-red-700', border: 'border-red-500' })),
  '#F5A623': once((): ColorStyles => ({ base: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-500' })),
  '#9B59B6': once((): ColorStyles => ({ base: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-500' })),
};
