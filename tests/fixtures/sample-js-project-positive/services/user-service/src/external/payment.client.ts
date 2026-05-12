// Outbound HTTP client for the upstream billing provider. Lives under
// `external/` and uses the `*.client.ts` suffix so the layer detector tags
// it as the external integration layer — this is the only file in the
// service allowed to talk to the payments vendor directly.

declare const fetch: (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface PaymentResult {
  readonly status: 'succeeded' | 'failed';
  readonly providerId: string;
}

const PAYMENTS_BASE_URL = 'https://payments.example.com';

export async function processPayment(orderId: string, amountCents: number): Promise<PaymentResult> {
  const res = await fetch(`${PAYMENTS_BASE_URL}/orders/${orderId}/charge`, {
    method: 'POST',
    body: JSON.stringify({ amount: amountCents }),
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    return { status: 'failed', providerId: '' };
  }
  const body = (await res.json()) as { id: string };
  return { status: 'succeeded', providerId: body.id };
}
