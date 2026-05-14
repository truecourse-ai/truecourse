
// tx.organisation.update already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  organisation: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
  organisationClaim: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
};

export async function migrateOrganisationPlan(
  orgId: string,
  claimId: string,
  newPlanData: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.organisation.update({
      where: { id: orgId },
      data: { customerId: null },
    });
    await tx.organisationClaim.update({
      where: { id: claimId },
      data: newPlanData,
    });
  });
}
