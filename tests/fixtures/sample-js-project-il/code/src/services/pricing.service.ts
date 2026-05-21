import type { Customer } from '../types.js';

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
