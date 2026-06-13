import type { Customer, LoyaltyTier } from '../types.js';

/**
 * Customer preference + loyalty-downgrade rules.
 *
 * This service is where three cross-cutting decisions live in code:
 *
 *   1. A conditional field-requiredness guard (validation-rule): a downgrade
 *      reason is only required when a `gold` customer downgrades themselves.
 *   2. A runtime null/absent → default coalescing (fallback): a customer with
 *      no recorded tier is billed as `standard`.
 *   3. A storage-strategy split (persistence-strategy): `loyaltyTier` is a
 *      first-class Prisma column, but `marketingOptIn` / `betaFeatures` are
 *      kept as keys inside the customer's `metadata` JSON blob.
 */

const DEFAULT_LOYALTY_TIER: LoyaltyTier = 'standard';

export class PreferenceValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A row as stored: the scalar columns plus the free-form metadata blob. */
interface CustomerRow extends Customer {
  metadata: Record<string, unknown> | null;
}

export interface CustomerPreferences {
  loyaltyTier: LoyaltyTier;
  marketingOptIn: boolean;
  betaFeatures: boolean;
}

/**
 * Project a stored customer row into the flat preferences the API exposes.
 *
 * `loyaltyTier` is a dedicated schema column read straight off the row;
 * `marketingOptIn` and `betaFeatures` are NOT columns — they live as keys
 * inside the `metadata` JSON blob, so they are read through it.
 */
export function readPreferences(customer: CustomerRow): CustomerPreferences {
  // Runtime fallback: a customer with no recorded tier is treated as standard.
  const loyaltyTier = customer.loyaltyTier ?? DEFAULT_LOYALTY_TIER;
  const metadata = customer.metadata;
  return {
    loyaltyTier,
    // Metadata-JSON keys — read off the blob, never their own column.
    marketingOptIn: Boolean(metadata?.marketingOptIn),
    betaFeatures: Boolean(metadata?.['betaFeatures']),
  };
}

export interface DowngradeInput {
  customerId: string;
  targetTier: LoyaltyTier;
  downgradeReason?: string;
}

/**
 * Guard a self-service loyalty downgrade. A gold customer downgrading their
 * own tier must record why — the reason feeds win-back outreach. Staff-side
 * downgrades (actor `admin`) and non-gold customers are exempt.
 */
export function validateDowngrade(
  customer: Customer,
  actor: string,
  input: DowngradeInput,
): void {
  const downgradeReason = input.downgradeReason;
  if (
    customer.loyaltyTier === 'gold' &&
    actor === 'customer' &&
    !downgradeReason
  ) {
    throw new PreferenceValidationError(
      'downgrade_reason_required',
      'A reason is required when a gold customer downgrades their own tier.',
    );
  }
}
