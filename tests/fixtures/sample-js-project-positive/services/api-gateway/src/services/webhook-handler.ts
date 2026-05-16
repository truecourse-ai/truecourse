
// Idiomatic TypeScript typed-initialization pattern: the null initial value
// is never read — if parsing fails the function throws; otherwise the variable
// is reassigned and then used. The null initializer serves as a type
// annotation anchor for the conditional assignment.
type SubscriptionCreatePayload = { planId: string; userId: string; organisationName: string };
declare function parsePayload(raw: string): { success: true; data: SubscriptionCreatePayload } | { success: false };
declare function throwBadRequest(msg: string): never;
declare function provisionSubscription(data: SubscriptionCreatePayload): Promise<string>;

async function handleSubscriptionCreated(rawPayload: string): Promise<string> {
  let subscriptionCreateData: SubscriptionCreatePayload | null = null;

  const parseResult = parsePayload(rawPayload);

  if (!parseResult.success) {
    throwBadRequest('Invalid subscription create payload');
  }

  subscriptionCreateData = (parseResult as { success: true; data: SubscriptionCreatePayload }).data;

  return provisionSubscription(subscriptionCreateData);
}


// Type assertion of payment provider event previous_attributes required by SDK typing
type PaymentEventObject = { object: 'subscription' | 'invoice' | 'charge'; id: string };

declare function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string,
): Promise<{ type: string; data: { object: unknown; previous_attributes?: unknown } }>;

export async function handlePaymentWebhook(rawBody: Buffer, signature: string): Promise<void> {
  const event = await verifyWebhookSignature(rawBody, signature);

  if (event.type === 'customer.subscription.updated') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prevAttrs = event.data.previous_attributes as Record<string, any>;

    if (prevAttrs?.cancel_at_period_end !== undefined) {
      const subscription = event.data.object as PaymentEventObject;
      await handleSubscriptionCancellationChange(subscription.id, prevAttrs.cancel_at_period_end as boolean);
    }
  }
}

declare function handleSubscriptionCancellationChange(id: string, willCancel: boolean): Promise<void>;



// restricted-api-usage: 'location' global used directly for redirect — should use router
declare function buildLogoutUrl(): string;

export function logoutAndRedirect(): void {
  const logoutUrl = buildLogoutUrl();
  location.assign(logoutUrl);
}

