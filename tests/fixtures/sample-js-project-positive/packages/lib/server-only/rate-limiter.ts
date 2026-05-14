// enum-exhaustive-record-lookup: multipliers[unit] where unit cast to WindowUnit after slice
type TimeUnit = 's' | 'm' | 'h' | 'd';

function parseWindowDuration(windowStr: string): number {
  const value = parseInt(windowStr.slice(0, -1), 10);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const unit = windowStr.slice(-1) as TimeUnit;

  const multipliers: Record<TimeUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}
