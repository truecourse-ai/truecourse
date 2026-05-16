
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; document: { updateMany: (args: any) => Promise<any> }; teamMember: { update: (args: any) => Promise<any> }; };

export async function transferOwnership(fromUserId: number, toUserId: number, teamId: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.document.updateMany({
      where: { ownerId: fromUserId, teamId },
      data: { ownerId: toUserId },
    });

    await tx.teamMember.update({
      where: { teamId_userId: { teamId, userId: toUserId } },
      data: { role: 'OWNER' },
    });
  });
}
