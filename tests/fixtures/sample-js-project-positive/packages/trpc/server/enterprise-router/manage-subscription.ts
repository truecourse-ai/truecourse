declare const prisma: { subscription: { findFirst: (args: unknown) => Promise<unknown | null>; upsert: (args: unknown) => Promise<unknown> } };
declare const billingClient: { createCheckoutSession: (opts: unknown) => Promise<{ url: string }>; cancelSubscription: (subscriptionId: string) => Promise<void>; getSubscription: (subscriptionId: string) => Promise<{ status: string; currentPeriodEnd: Date }> };
declare const requireBillingAdmin: (userId: string, organisationId: string) => Promise<void>;
declare const SubscriptionStatus: { ACTIVE: string; CANCELLED: string; TRIAL: string };

import { z } from 'zod';

const ManageSubscriptionSchema = z.object({
  organisationId: z.string().cuid(),
  userId: z.string().cuid(),
  action: z.enum(['start', 'cancel', 'refresh']),
  planId: z.string().optional(),
  returnUrl: z.string().url().optional(),
});

export async function manageSubscription(input: z.infer<typeof ManageSubscriptionSchema>) {
  const { organisationId, userId, action, planId, returnUrl } = ManageSubscriptionSchema.parse(input);

  await requireBillingAdmin(userId, organisationId);

  if (action === 'start') {
    if (!planId || !returnUrl) {
      throw new Error('planId and returnUrl are required to start a subscription');
    }
    const session = await billingClient.createCheckoutSession({
      organisationId,
      planId,
      returnUrl,
    });
    return { checkoutUrl: session.url };
  }

  const subscription = await prisma.subscription.findFirst({
    where: { organisationId },
    select: { id: true, externalId: true, status: true },
  });

  if (!subscription) {
    throw new Error('No active subscription found for this organisation');
  }

  if (action === 'cancel') {
    await billingClient.cancelSubscription((subscription as { externalId: string }).externalId);
    await prisma.subscription.upsert({
      where: { id: (subscription as { id: string }).id },
      update: { status: SubscriptionStatus.CANCELLED },
      create: {},
    });
    return { cancelled: true };
  }

  const latest = await billingClient.getSubscription((subscription as { externalId: string }).externalId);
  await prisma.subscription.upsert({
    where: { id: (subscription as { id: string }).id },
    update: { status: latest.status, currentPeriodEnd: latest.currentPeriodEnd },
    create: {},
  });

  return { subscription: latest };
}
