
// tx.account.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  account: { create(args: { data: unknown }): Promise<{ id: string }> };
  userSecurityAuditLog: { create(args: { data: unknown }): Promise<{ id: number }> };
};

export async function linkOAuthAccount(
  userId: number,
  provider: string,
  providerAccountId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.account.create({
      data: { userId, provider, providerAccountId, type: 'oauth' },
    });
    await tx.userSecurityAuditLog.create({
      data: { userId, type: 'ACCOUNT_SSO_LINK' },
    });
  });
}
