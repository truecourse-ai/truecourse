
// FP: single DB write — only prisma.organisation.update, followed by external stripe call
declare const db: { organisation: { update(args: any): Promise<any> } };
declare const stripeClient: { customers: { update(id: string, data: any): Promise<any> } };

export async function removeTeamMemberAndSyncBilling(
  teamId: string,
  memberId: number,
  customerId: string,
): Promise<void> {
  // Single DB write: update the org to reflect reduced member count
  await db.organisation.update({
    where: { teamId },
    data: { memberCount: { decrement: 1 } },
  });

  // External API call — not a DB write, should not trigger missing-transaction
  await stripeClient.customers.update(customerId, {
    metadata: { memberCount: 'reduced' },
  });
}
