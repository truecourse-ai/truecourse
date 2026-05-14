
// tx.userSecurityAuditLog.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  account: { create(args: { data: unknown }): Promise<{ id: string }> };
  userSecurityAuditLog: { create(args: { data: unknown }): Promise<{ id: number }> };
  user: { update(args: { where: { id: number }; data: unknown }): Promise<{ id: number }> };
};

export async function linkSsoAndAudit(
  userId: number,
  accountData: unknown,
  auditMeta: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.account.create({ data: accountData });
    await tx.userSecurityAuditLog.create({
      data: { userId, type: 'ACCOUNT_SSO_LINK', ...auditMeta },
    });
    await tx.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
  });
}
