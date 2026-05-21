/**
 * Positive fixture for reliability/deterministic/unchecked-array-access.
 *
 * Three FP shapes that the visitor previously flagged:
 *
 *  1. `Record<Union, V>` lookup by a value typed as `Union` — the type system
 *     proves every key is present, but the visitor only suppressed the
 *     inline-cast `({…} as Record<…>)[k]` shape, not a locally-typed binding.
 *
 *  2. Augmented assignment to a computed slot (`counts[k] += 1`). The read and
 *     write happen together; the LHS is an intentional update, not an
 *     unguarded read.
 *
 *  3. Subscript result fed through a function and the OUTER expression supplies
 *     a fallback (`t(MAP[k]) ?? k`). The fallback applies after the wrapping
 *     call, so the access is still safe.
 */

type WindowUnit = 's' | 'm' | 'h' | 'd';

export const windowMs = (value: number, unit: WindowUnit): number => {
  const multipliers: Record<WindowUnit, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * multipliers[unit];
};

type SignStatus = 'SIGNED' | 'NOT_SIGNED' | 'REJECTED';

export const tallyStatuses = (
  events: readonly { status: SignStatus }[],
): Record<SignStatus, number> => {
  const counts: Record<SignStatus, number> = {
    SIGNED: 0,
    NOT_SIGNED: 0,
    REJECTED: 0,
  };

  for (const event of events) {
    const { status } = event;
    counts[status] += 1;
  }

  return counts;
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  member: 'Member',
};

declare function translate(value: string | undefined): string | undefined;

export const labelFor = (role: string): string => {
  return translate(ROLE_LABELS[role]) ?? role;
};
