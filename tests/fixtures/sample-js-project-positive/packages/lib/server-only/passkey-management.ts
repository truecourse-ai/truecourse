
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; passkey: { delete: (args: any) => Promise<any> }; passkeyChallenge: { deleteMany: (args: any) => Promise<any> }; auditLog: { create: (args: any) => Promise<any> }; };

export async function revokePasskey(userId: number, passkeyId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.passkey.delete({
      where: { id: passkeyId, userId },
    });

    await tx.passkeyChallenge.deleteMany({
      where: { passkeyId },
    });

    await tx.auditLog.create({
      data: {
        userId,
        event: 'PASSKEY_REVOKED',
        metadata: { passkeyId },
        createdAt: new Date(),
      },
    });
  });
}
