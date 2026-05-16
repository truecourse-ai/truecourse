
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; oauthAccount: { create: (args: any) => Promise<any> }; user: { update: (args: any) => Promise<any> }; };

export async function linkOAuthAccount(userId: number, provider: string, providerAccountId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.oauthAccount.create({
      data: {
        userId,
        provider,
        providerAccountId,
        linkedAt: new Date(),
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { hasOAuth: true },
    });
  });
}
