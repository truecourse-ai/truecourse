
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; user: { update: (args: any) => Promise<any> }; securityAuditLog: { create: (args: any) => Promise<any> }; };
declare function hashPassword(plain: string): Promise<string>;

export async function changeUserPassword(userId: number, newPassword: string, ipAddress: string): Promise<void> {
  const hashed = await hashPassword(newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hashed, passwordChangedAt: new Date() },
    });

    await tx.securityAuditLog.create({
      data: {
        userId,
        event: 'PASSWORD_CHANGED',
        ipAddress,
        createdAt: new Date(),
      },
    });
  });
}
