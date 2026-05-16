
// FP shape: job io.runTask wrapping ORM update; no type mismatch
declare const io: { runTask: <T>(name: string, fn: () => Promise<T>) => Promise<T> };
declare const db: { subscription: { update: (args: { where: unknown; data: unknown }) => Promise<unknown> } };
declare const subscriptionId: string;

async function processRenewal() {
  await io.runTask('update-subscription', async () =>
    db.subscription.update({
      where: { id: subscriptionId },
      data: { renewedAt: new Date(), active: true },
    })
  );
}
