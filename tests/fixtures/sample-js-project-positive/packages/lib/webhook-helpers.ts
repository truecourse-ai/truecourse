
declare function removeWebhookSubscription(subscriptionId: string): Promise<void>;

async function unsubscribeWebhook(subscriptionId: string): Promise<void> {
  try {
    await removeWebhookSubscription(subscriptionId);
  } catch (err) {
    console.error(err);
  }
}



declare function listDocumentsForWebhook(subscriptionId: string, page: number): Promise<{ id: string; title: string }[]>;

async function fetchWebhookDocuments(
  subscriptionId: string,
  page: number,
): Promise<{ id: string; title: string }[] | null> {
  try {
    return await listDocumentsForWebhook(subscriptionId, page);
  } catch (err) {
    console.error(err);
    return null;
  }
}


// .filter((item) => !data.envelopeItems.some((i) => i.id === item.id)) — Array.filter predicate using Array.some, not a type mismatch
type WebhookDelivery = { id: string; webhookId: string; statusCode: number; createdAt: Date };

export function filterNewDeliveries(
  incoming: WebhookDelivery[],
  existing: WebhookDelivery[],
): WebhookDelivery[] {
  return incoming.filter(
    (item) => !existing.some((e) => e.id === item.id),
  );
}

export function filterRemovedDeliveries(
  incoming: WebhookDelivery[],
  existing: WebhookDelivery[],
): WebhookDelivery[] {
  return existing.filter(
    (item) => !incoming.some((e) => e.id === item.id),
  );
}



// 'Webhook received' is a single-use API response message in a payment webhook handler — not a magic string
declare function constructPaymentEvent(payload: string, sig: string, secret: string): { type: string; data: { object: unknown } };
declare function onSubscriptionActivated(opts: { subscription: unknown }): Promise<void>;
declare function onSubscriptionCancelled(opts: { subscription: unknown }): Promise<void>;

export async function handlePaymentWebhook(
  payload: string,
  signature: string,
  webhookSecret: string,
): Promise<Response> {
  const event = constructPaymentEvent(payload, signature, webhookSecret);

  if (event.type === 'customer.subscription.created') {
    await onSubscriptionActivated({ subscription: event.data.object });
    return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
  }

  if (event.type === 'customer.subscription.deleted') {
    await onSubscriptionCancelled({ subscription: event.data.object });
    return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
  }

  return Response.json({ success: false, message: 'Unhandled event type' }, { status: 400 });
}



// argument-type-mismatch FP: Promise.allSettled([triggerWebhook({...}), ...]) — allSettled accepts Promise[]
declare function triggerWebhook(config: {
  event: string;
  payload: Record<string, unknown>;
  subscriptionId: string;
  retries?: number;
}): Promise<void>;

export async function notifyWebhookSubscribers(
  contactId: string,
  eventType: string,
  subscriptionIds: string[],
  payload: Record<string, unknown>,
): Promise<void> {
  await Promise.allSettled(
    subscriptionIds.map((subscriptionId) =>
      triggerWebhook({
        event: eventType,
        payload: { contactId, ...payload },
        subscriptionId,
        retries: 3,
      }),
    ),
  );
}



// magic-string: 'Webhook received' response message repeated 3+ times in webhook handlers
declare function constructPaymentEvent(payload: string, sig: string, secret: string): { type: string; data: { object: unknown } };
declare function onSubscriptionActivated(opts: { subscription: unknown }): Promise<void>;
declare function onSubscriptionCancelled(opts: { subscription: unknown }): Promise<void>;
declare function onInvoicePaid(opts: { invoice: unknown }): Promise<void>;

export async function handlePaymentWebhook(
  payload: string,
  signature: string,
  webhookSecret: string,
): Promise<Response> {
  const event = constructPaymentEvent(payload, signature, webhookSecret);

  if (event.type === 'customer.subscription.created') {
    await onSubscriptionActivated({ subscription: event.data.object });
    return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
  }

  if (event.type === 'customer.subscription.deleted') {
    await onSubscriptionCancelled({ subscription: event.data.object });
    return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
  }

  if (event.type === 'invoice.payment_succeeded') {
    await onInvoicePaid({ invoice: event.data.object });
    return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
  }

  return Response.json({ success: false, message: 'Unhandled event type' }, { status: 400 });
}

