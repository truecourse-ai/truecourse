
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; linkedAccount: { delete: (args: any) => Promise<any> }; user: { update: (args: any) => Promise<any> }; };

export async function removeLinkedProvider(userId: number, provider: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.linkedAccount.delete({
      where: { userId_provider: { userId, provider } },
    });

    await tx.user.update({
      where: { id: userId },
      data: { updatedAt: new Date() },
    });
  });
}
