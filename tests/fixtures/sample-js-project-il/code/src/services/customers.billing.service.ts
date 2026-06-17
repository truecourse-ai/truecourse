import { prisma } from '../db.js';

/**
 * Customer billing-summary read path.
 *
 * The billing summary is the account-billing view a customer sees: it projects
 * the billing-relevant columns and returns them to the caller. The contract
 * `customer.store-credit-exposed` says the customer's `storeCredit` balance must
 * travel on this read path — it must be part of the read projection so the
 * balance reaches the consumer.
 *
 * This implementation's projection selects `balanceCents` but OMITS
 * `storeCredit`, so the store-credit balance is never selected and never
 * reaches the consumer — the exposure the contract promises is dropped.
 */

export interface BillingSummary {
  balanceCents: number;
}

/**
 * Load the billing summary for a customer. The `select` projection is the
 * exposed column set — `storeCredit` is not part of it.
 */
export async function readBillingSummary(id: string): Promise<BillingSummary | null> {
  const row = await prisma.customer.findUnique({
    where: { id },
    // IL-DRIFT: FieldExposure:customer.store-credit-exposed / field-exposure.customer.store-credit-exposed.not-exposed
    select: {
      balanceCents: true,
    },
  });
  return (row as BillingSummary) ?? null;
}
