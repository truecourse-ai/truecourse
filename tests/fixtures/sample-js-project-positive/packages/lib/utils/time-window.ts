
// FP: window.slice(-1) as TimeUnit — the parameter type WindowStr is `${number}${'s'|'m'|'h'|'d'}`,
// so the last character is always a TimeUnit. The assertion is guaranteed by the input type.
type TimeUnit = 's' | 'm' | 'h' | 'd';
type WindowStr = `${number}${TimeUnit}`;

export function parseWindowMs(window: WindowStr): number {
  const value = parseInt(window.slice(0, -1), 10);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const unit = window.slice(-1) as TimeUnit;

  const multipliers: Record<TimeUnit, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * multipliers[unit];
}
