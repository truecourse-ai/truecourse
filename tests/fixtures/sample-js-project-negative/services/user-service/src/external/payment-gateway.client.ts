// External HTTP client for the payment gateway. Lives in the external layer
// (path: external/*client*.ts) so the data layer is never supposed to reach
// in here directly — it must go through the service layer instead.

declare const fetch: (input: string, init?: { method?: string; body?: string }) => Promise<{ json(): Promise<unknown> }>;

const PAYMENT_GATEWAY_BASE = 'https://payments.example.com';

export async function chargeCustomer(customerId: string, cents: number): Promise<{ id: string }> {
  const res = await fetch(`${PAYMENT_GATEWAY_BASE}/charges`, {
    method: 'POST',
    body: JSON.stringify({ customerId, amount: cents }),
  });
  return (await res.json()) as { id: string };
}
