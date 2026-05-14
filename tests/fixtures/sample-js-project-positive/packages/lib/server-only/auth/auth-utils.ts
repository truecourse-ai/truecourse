
// FP shape fa5ca35bdb27: prisma.$transaction with user.update for password reset — no type mismatch
declare function compare(plain: string, hashed: string): Promise<boolean>;
declare function hash(plain: string, rounds: number): Promise<string>;
declare class AppError extends Error { constructor(code: string); }
declare const prisma: {
  $transaction: <T>(fn: (tx: { user: { update: (args: object) => Promise<{ id: string }> }; passwordResetToken: { deleteMany: (args: object) => Promise<void> } }) => Promise<T>) => Promise<T>;
};
declare const SALT_ROUNDS: number;

async function resetUserPassword(userId: string, password: string, tokenId: string) {
  const hashedPassword = await hash(password, SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    await tx.passwordResetToken.deleteMany({
      where: { id: tokenId },
    });
  });
}
