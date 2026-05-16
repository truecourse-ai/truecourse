
// tx.passwordResetToken.updateMany already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  userSecurityAuditLog: { create(args: { data: unknown }): Promise<{ id: number }> };
  passwordResetToken: { deleteMany(args: { where: { userId: number } }): Promise<{ count: number }> };
  user: { update(args: { where: { id: number }; data: unknown }): Promise<{ id: number }> };
};

export async function changePassword(
  userId: number,
  hashedPassword: string,
  requestMeta: { userAgent?: string; ipAddress?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userSecurityAuditLog.create({
      data: { userId, type: 'PASSWORD_UPDATE', ...requestMeta },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.user.update({ where: { id: userId }, data: { password: hashedPassword } });
  });
}
