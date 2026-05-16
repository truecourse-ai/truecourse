export function runCode_9e3dfc6b(src: string): unknown {
  return eval(src);
}


// Type assertions required by provider SDK: event.data.object is a discriminated union
type ProviderSubscription = { id: string; status: string; currentPeriodEnd: number };
type ProviderInvoice = { id: string; amountDue: number; paid: boolean };
type WebhookEventData = { object: ProviderSubscription | ProviderInvoice };

declare function getProviderWebhookEvent(rawBody: Buffer, sig: string): Promise<{ type: string; data: WebhookEventData }>;
declare function handleProviderSubscriptionChange(sub: ProviderSubscription): Promise<void>;
declare function handleProviderInvoicePaid(inv: ProviderInvoice): Promise<void>;

export async function routeProviderWebhookEvent(rawBody: Buffer, sig: string): Promise<void> {
  const event = await getProviderWebhookEvent(rawBody, sig);

  switch (event.type) {
    case 'subscription.created':
    case 'subscription.updated': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subscription = event.data.object as ProviderSubscription;
      await handleProviderSubscriptionChange(subscription);
      break;
    }

    case 'invoice.payment_succeeded': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoice = event.data.object as ProviderInvoice;
      await handleProviderInvoicePaid(invoice);
      break;
    }
  }
}



// restricted-api-usage: 'location' global used directly — should use router navigation instead
declare function getRedirectPath(reason: string): string;

export function redirectToLogin(reason: string): void {
  const path = getRedirectPath(reason);
  location.href = path;
}

