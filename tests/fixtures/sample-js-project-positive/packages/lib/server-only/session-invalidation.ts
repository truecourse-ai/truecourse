
// tx.session.deleteMany already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  session: { deleteMany(args: { where: unknown }): Promise<{ count: number }> };
  userSecurityAuditLog: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
};

export async function invalidateSessions(
  userId: number,
  sessionIds: string[],
  metadata: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.session.deleteMany({
      where: { userId, id: { in: sessionIds } },
    });
    if (count !== sessionIds.length) {
      throw new Error('Session mismatch');
    }
    await tx.userSecurityAuditLog.createMany({
      data: sessionIds.map(() => ({ userId, type: 'SIGN_OUT', ...metadata })),
    });
  });
}
