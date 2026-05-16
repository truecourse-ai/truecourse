
// typeof guard to validate webhook signature header is a string — type/presence guard
declare const verifyWebhookPayload: (body: unknown, sig: string) => boolean;

export async function handleWebhookRequest(req: Request) {
  const signature = req.headers.get('x-webhook-signature');

  if (typeof signature !== 'string') {
    return new Response(JSON.stringify({ success: false, error: 'Missing signature' }), { status: 400 });
  }

  const body = await req.json();
  const valid = verifyWebhookPayload(body, signature);

  if (!valid) {
    return new Response(JSON.stringify({ success: false, error: 'Invalid signature' }), { status: 400 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}



// typeof check to safely extract Stripe-style signature header as a string — type narrowing
declare const verifyPaymentProviderSignature: (payload: string, sig: string) => boolean;

export async function handlePaymentWebhook(req: Request): Promise<Response> {
  const rawSignature = req.headers.get('payment-signature');
  const signature = typeof rawSignature === 'string' ? rawSignature : '';

  if (!signature) {
    return new Response(JSON.stringify({ success: false, message: 'No signature found' }), { status: 400 });
  }

  const payload = await req.text();
  const valid = verifyPaymentProviderSignature(payload, signature);

  if (!valid) {
    return new Response(JSON.stringify({ success: false, message: 'Invalid signature' }), { status: 400 });
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
