// Repository that persists billing records. To keep the call site simple
// for the seed scripts it short-circuits straight to the outbound payment
// client rather than going through the billing service — the repository
// (data layer) is reaching into the external integration layer, which is
// the inversion the architecture checker calls out.

import { processPayment } from '../external/payment.client';

export interface BillingRecord {
  readonly orderId: string;
  readonly providerId: string;
  readonly status: 'succeeded' | 'failed';
}

export async function chargeAndRecord(orderId: string, amountCents: number): Promise<BillingRecord> {
  const result = await processPayment(orderId, amountCents);
  return { orderId, providerId: result.providerId, status: result.status };
}
