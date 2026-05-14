
// tx.passkey.create already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  passkey: { create(args: { data: unknown }): Promise<{ id: string }> };
  userSecurityAuditLog: { create(args: { data: unknown }): Promise<{ id: number }> };
};

export async function registerPasskey(
  userId: number,
  credentialData: unknown,
  requestMetadata: { userAgent?: string; ipAddress?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.passkey.create({ data: { userId, ...credentialData as object } });
    await tx.userSecurityAuditLog.create({
      data: { userId, type: 'PASSKEY_CREATED', ...requestMetadata },
    });
  });
}
