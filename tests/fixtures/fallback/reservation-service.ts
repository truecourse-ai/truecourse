/**
 * Realistic reservation service. Several inputs have RUNTIME fallbacks — a
 * default value substituted when the caller omits the field. These live in
 * code (read/use time), not in the schema, so they're the thing that
 * silently changes behaviour if the coalescing literal drifts.
 */

export const DEFAULT_TIMEZONE = 'UTC';

export interface CreateReservationInput {
  guestId: string;
  currency?: string;
  timezone?: string;
  partySize?: number;
  notifyGuest?: boolean;
}

export interface Reservation {
  guestId: string;
  currency: string;
  timezone: string;
  partySize: number;
  notifyGuest: boolean;
  locale: string;
}

/**
 * Nullish coalescing fallback: when the caller omits `currency`, bill in
 * USD. A drift here (USD → EUR) silently changes every reservation's
 * default billing currency.
 */
function resolveCurrency(input: CreateReservationInput): string {
  return input.currency ?? 'USD';
}

/**
 * Default-parameter fallback: `locale` defaults to en-US when not passed.
 */
function buildLocale(locale = 'en-US'): string {
  return locale.toLowerCase();
}

export function createReservation(input: CreateReservationInput): Reservation {
  const currency = resolveCurrency(input);

  // Identifier fallback via `??` — defaults to the named constant.
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;

  // Numeric coalescing default.
  const partySize = input.partySize ?? 2;

  // Guarded-assignment fallback: explicit notify flag defaults to true.
  let notifyGuest = input.notifyGuest;
  if (notifyGuest == null) {
    notifyGuest = true;
  }

  return {
    guestId: input.guestId,
    currency,
    timezone,
    partySize,
    notifyGuest,
    locale: buildLocale(),
  };
}
