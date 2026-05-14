
// tx.user.update already inside a prisma.$transaction block
declare const prisma: {
  $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T>;
  user: { update(args: { where: { id: number }; data: unknown }): Promise<{ id: number }> };
  apiToken: { updateMany(args: { where: { userId: number }; data: unknown }): Promise<{ count: number }> };
  webhook: { updateMany(args: { where: { userId: number }; data: unknown }): Promise<{ count: number }> };
  verificationToken: { updateMany(args: { where: { userId: number }; data: unknown }): Promise<{ count: number }> };
};

export async function deactivateUser(userId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { disabled: true } });
    await tx.apiToken.updateMany({ where: { userId }, data: { expires: new Date() } });
    await tx.webhook.updateMany({ where: { userId }, data: { enabled: false } });
    await tx.verificationToken.updateMany({ where: { userId }, data: { expires: new Date() } });
  });
}
