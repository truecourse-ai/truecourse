
declare const paymentProvider: { webhooks: { constructEvent: (p: any, s: any, sec: any) => any } };
declare function onSubscriptionCreated(opts: any): Promise<void>;
declare function onSubscriptionUpdated(opts: any): Promise<void>;
declare function onSubscriptionDeleted(opts: any): Promise<void>;
declare const match: (v: any) => any;

export async function handlePaymentWebhook(payload: any, signature: string, secret: string) {
  const event = paymentProvider.webhooks.constructEvent(payload, signature, secret);

  return await match(event.type)
    .with('subscription.created', async () => {
      await onSubscriptionCreated({ subscription: event.data.object });
      return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
    })
    .with('subscription.updated', async () => {
      await onSubscriptionUpdated({ subscription: event.data.object });
      return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
    })
    .with('subscription.deleted', async () => {
      await onSubscriptionDeleted({ subscription: event.data.object });
      return Response.json({ success: true, message: 'Webhook received' }, { status: 200 });
    })
    .otherwise(() => Response.json({ success: false, message: 'Unhandled event' }, { status: 200 }));
}
