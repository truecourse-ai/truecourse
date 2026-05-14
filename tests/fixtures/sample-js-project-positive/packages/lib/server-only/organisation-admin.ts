
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; subscriptionClaim: { update: (args: any) => Promise<any> }; organisation: { update: (args: any) => Promise<any> }; };

export async function applySubscriptionClaim(organisationId: number, claimId: number, seats: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.subscriptionClaim.update({
      where: { id: claimId },
      data: { appliedAt: new Date(), seats },
    });

    await tx.organisation.update({
      where: { id: organisationId },
      data: { claimId },
    });
  });
}
