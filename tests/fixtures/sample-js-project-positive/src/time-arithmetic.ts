/**
 * Time arithmetic patterns that should NOT trigger magic-number.
 *
 * The magic-number rule skips time conversion factors
 * when they appear in a multiplication chain with at least one other time factor.
 * Named constants with SCREAMING_SNAKE names are also skipped.
 */

const TIMEOUT_MS = 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function getTimeoutMs(): number {
  return TIMEOUT_MS;
}

export function getWeekMs(): number {
  return WEEK_MS;
}

export function getHalfHourMs(): number {
  return HALF_HOUR_MS;
}

export function getOneDayMs(): number {
  return ONE_DAY_MS;
}

export function getFiveMinutesMs(): number {
  return FIVE_MINUTES_MS;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isExpired(timestamp: number): boolean {
  return Date.now() - timestamp > ONE_DAY_MS;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${hours}h ${minutes % MINUTES_PER_HOUR}m ${seconds % SECONDS_PER_MINUTE}s`;
}
