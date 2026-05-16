// VIOLATION: architecture/deterministic/data-layer-depends-on-external
// Repository that records billing events. Reaches directly into the external
// payment-gateway client instead of being driven by the billing service.
import { chargeCustomer } from '../external/payment-gateway.client';

export async function chargeAndRecord(customerId: string, cents: number): Promise<{ id: string }> {
  const charge = await chargeCustomer(customerId, cents);
  return charge;
}
