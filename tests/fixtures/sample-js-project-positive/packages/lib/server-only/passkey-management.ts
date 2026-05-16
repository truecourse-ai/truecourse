
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


// $transaction with async update callback — standard Prisma usage; no type mismatch.
declare const db26: {
  $transaction<T>(fn: (tx: {
    token: { update(args: { where: { id: string }; data: unknown }): Promise<{ id: string }> };
    auditLog: { create(args: { data: unknown }): Promise<void> };
  }) => Promise<T>): Promise<T>;
};
declare const userId26: string;

export async function enableFeatureForUser26(featureId: string): Promise<{ id: string }> {
  return db26.$transaction(async (tx) => {
    const token = await tx.token.update({
      where: { id: featureId },
      data: { enabledAt: new Date(), enabledByUserId: userId26 },
    });
    await tx.auditLog.create({
      data: { action: 'FEATURE_ENABLED', userId: userId26, featureId },
    });
    return token;
  });
}

