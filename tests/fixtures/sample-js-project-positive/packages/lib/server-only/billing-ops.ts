
// tx.subscription.delete already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  subscription: {
    delete(args: { where: { id: string } }): Promise<{ id: string }>;
  };
  organisationClaim: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
};

export async function cancelIndividualSubscription(
  subscriptionId: string,
  claimId: string,
  freePlanData: unknown,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.subscription.delete({ where: { id: subscriptionId } });
    await tx.organisationClaim.update({ where: { id: claimId }, data: freePlanData });
  });
}
