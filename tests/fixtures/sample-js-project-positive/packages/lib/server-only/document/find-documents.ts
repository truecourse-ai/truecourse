
// /d$/ strips trailing 'd' from a period string like '7d' to extract days — ASCII literal match.
export function parsePeriodDays(period: string): number {
  return parseInt(period.replace(/d$/, ''), 10);
}
