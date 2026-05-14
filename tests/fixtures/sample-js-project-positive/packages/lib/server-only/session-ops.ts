
// tx.userSecurityAuditLog.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  session: { deleteMany(args: { where: unknown }): Promise<{ count: number }> };
  userSecurityAuditLog: { createMany(args: { data: unknown[] }): Promise<{ count: number }> };
};

export async function revokeSessionsAndAudit(
  userId: number,
  sessionIds: string[],
  meta: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId, id: { in: sessionIds } } });
    await tx.userSecurityAuditLog.createMany({
      data: sessionIds.map(() => ({ userId, type: 'SESSION_REVOKED', ...meta })),
    });
  });
}
