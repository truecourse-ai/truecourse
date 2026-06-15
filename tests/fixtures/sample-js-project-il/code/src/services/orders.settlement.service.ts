import type { Order } from '../types.js';

/**
 * Order settlement helpers.
 *
 * Settlement is the point where an order's totals are committed to a payment
 * processor in a specific currency. The contract `order.currency-default` says
 * an order with no recorded settlement currency falls back to the named
 * constant `DEFAULT_CURRENCY` (USD) at read time.
 *
 * This implementation reads `order.currency` straight off the row with no
 * coalescing, so an order whose currency is null/absent settles with a missing
 * currency rather than the documented USD default — the fallback is never
 * applied.
 */

export const DEFAULT_CURRENCY = 'USD';

/** An order row as stored, including its (optionally absent) currency. */
interface SettlementRow extends Order {
  currency?: string | null;
}

export interface SettlementInstruction {
  orderId: string;
  amountCents: number;
  currency: string | null | undefined;
}

/**
 * Resolve the currency an order settles in. The stored `currency` is read
 * through directly — no fallback to the default when it is null/absent.
 */
export function resolveSettlementCurrency(order: SettlementRow): SettlementInstruction {
  // IL-DRIFT: Fallback:order.currency-default / fallback.order.currency-default.not-applied
  const currency = order.currency;
  return {
    orderId: order.id,
    amountCents: order.totalCents,
    currency,
  };
}
