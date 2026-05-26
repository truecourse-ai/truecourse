import type { Customer, CustomerTier } from '../types.js';

// Discount percentage by spend tier. Spec table is bronze 5, silver 10,
// gold 20. The gold rate drifted to 25, over-discounting gold orders.
// IL-DRIFT: NamedConstant:DiscountTiers / constant.DiscountTiers.value-mismatch
const DiscountTiers: Record<CustomerTier, number> = { bronze: 5, silver: 10, gold: 25 };

// Spec sets the pricing-service retry budget to 3. Code raised it to 5,
// so transient pricing failures retry past the latency SLO.
// IL-DRIFT: NamedConstant:MAX_RETRY / constant.MAX_RETRY.value-mismatch
const MAX_RETRY = 5;

// Spec also pins ApiVersion = "v2" as a named constant, but the code has
// no such declaration — version negotiation is hard-coded inline instead.
// IL-DRIFT: NamedConstant:ApiVersion / constant.ApiVersion.no-code-counterpart

/** Percentage discount the spend tier is entitled to. */
export function tierDiscountPercent(tier: CustomerTier): number {
  return DiscountTiers[tier];
}

/** Retry a pricing computation up to the configured budget. */
export async function computeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Pure pricing calculations. Inputs come from the request body + the
 * customer's loyalty tier; outputs become the order's discountCents,
 * taxCents, and totalCents fields. All money values in cents.
 */
export const pricingService = {
  computeDiscountCents(subtotalCents: number, customer: Customer): number {
    // Spec says discount applies when subtotalCents > 10000 (strict). Using
    // `>=` flips a $100.00 order from no-discount to 10%-off, silently
    // dropping revenue on the boundary.
    // IL-DRIFT: Formula:order.discount-cents / expression.threshold-operator.10000
    if (customer.loyaltyTier === 'gold' && subtotalCents >= 10000) {
      return Math.round(subtotalCents * 0.1);
    }
    return 0;
  },

  computeTaxCents(subtotalCents: number, _discountCents: number): number {
    // Spec says tax = 8% of (subtotalCents - discountCents). This computes
    // tax on the pre-discount subtotal, over-charging customers who got a
    // discount and quietly inflating reported tax revenue.
    // IL-DRIFT: Formula:order.tax-cents / inputs.discountCents.unused
    return Math.round(subtotalCents * 0.08);
  },

  computeTotalCents(
    subtotalCents: number,
    discountCents: number,
    taxCents: number,
  ): number {
    return subtotalCents - discountCents + taxCents;
  },
};
