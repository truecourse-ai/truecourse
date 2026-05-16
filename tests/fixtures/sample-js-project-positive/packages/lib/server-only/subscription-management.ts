
// FP: tx.organisation.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function clearOrganisationCustomer(
  sourceOrgId: string,
  targetOrgId: string,
  customerId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    // Clear customerId on source to avoid unique constraint violation
    await tx.organisation.update({
      where: { id: sourceOrgId },
      data: { customerId: null },
    });

    // Assign customerId to target
    await tx.organisation.update({
      where: { id: targetOrgId },
      data: { customerId },
    });
  });
}



// FP: tx.organisation.update (target) inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function transferSubscriptionToOrg(
  sourceOrgId: string,
  targetOrgId: string,
  subscriptionId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.subscription.delete({
      where: { organisationId: targetOrgId },
    });

    await tx.organisation.update({
      where: { id: sourceOrgId },
      data: { customerId: null },
    });

    await tx.organisation.update({
      where: { id: targetOrgId },
      data: { customerId: 'migrated' },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { organisationId: targetOrgId },
    });
  });
}



// FP: multiple tx.* calls inside prisma.$transaction — already in transaction (stripe webhook)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function handleSubscriptionRenewal(
  organisationId: string,
  planId: string,
  priceId: string,
  periodEnd: Date,
  newStatus: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { organisationId },
      data: {
        status: newStatus,
        planId,
        priceId,
        periodEnd,
      },
    });

    await tx.user.update({
      where: { organisationId },
      data: { subscriptionStatus: newStatus },
    });

    await tx.recipient.update({
      where: { organisationId },
      data: { updatedAt: new Date() },
    });
  });
}



// FP: tx.subscription.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function moveSubscriptionToOrganisation(
  subscriptionId: string,
  sourceOrgId: string,
  targetOrgId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.organisation.update({
      where: { id: sourceOrgId },
      data: { customerId: null },
    });

    await tx.organisation.update({
      where: { id: targetOrgId },
      data: { customerId: 'cust_migrated' },
    });

    await tx.subscription.update({
      where: { id: subscriptionId },
      data: { organisationId: targetOrgId },
    });
  });
}
