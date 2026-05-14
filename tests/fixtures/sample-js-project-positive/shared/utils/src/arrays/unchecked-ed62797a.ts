declare const arr: number[];
export function get_ed62797a(i: number): number {
  return arr[i] + arr[i + 1];
}


// Enum-exhaustive Record lookup: unit cast to RateLimitWindowUnit after suffix slice;
// multipliers Record covers all RateLimitWindowUnit values — lookup is always defined
type RateLimitWindowUnit = 's' | 'm' | 'h' | 'd';

export function parseRateLimitWindow(windowStr: string): number {
  const amount = parseInt(windowStr.slice(0, -1), 10);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const unit = windowStr.slice(-1) as RateLimitWindowUnit;

  const multipliers: Record<RateLimitWindowUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

