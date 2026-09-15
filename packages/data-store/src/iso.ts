/**
 * Postgres's rendering of a timestamptz, as ISO-8601 with a `Z`. Every record
 * a store hands out speaks ISO; a row speaks whatever the driver gave it.
 */
export function iso(stamp: string): string;
export function iso(stamp: string | null): string | null;
export function iso(stamp: string | null): string | null {
  if (stamp === null) return null;
  // `2026-09-10 12:00:00+00` — a space for the `T`, and a two-digit offset the
  // Date parser does not accept without its minutes.
  const dated = stamp.includes('T') ? stamp : stamp.replace(' ', 'T');
  const parsed = new Date(/[+-]\d{2}$/.test(dated) ? `${dated}:00` : dated);
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toISOString();
}
