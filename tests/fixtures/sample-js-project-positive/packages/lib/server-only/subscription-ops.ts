
// tx.subscription.delete already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  subscription: {
    delete(args: { where: { id: string } }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }>;
  };
  organisation: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
};

export async function transferSubscription(
  sourceOrgId: string,
  targetOrgId: string,
  subscriptionId: string,
  staleSubscriptionId?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (staleSubscriptionId) {
      await tx.subscription.delete({ where: { id: staleSubscriptionId } });
    }
    await tx.organisation.update({ where: { id: sourceOrgId }, data: { customerId: null } });
    await tx.organisation.update({ where: { id: targetOrgId }, data: { customerId: 'cus_abc' } });
    await tx.subscription.update({ where: { id: subscriptionId }, data: { organisationId: targetOrgId } });
  });
}
