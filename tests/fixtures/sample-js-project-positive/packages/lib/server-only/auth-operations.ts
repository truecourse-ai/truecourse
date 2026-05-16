
// FP: tx.user.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateRecoveryCodes(user: any): string[];
declare class AuthError extends Error { constructor(code: string); }

export async function enableTwoFactor(userId: number, totpCode: string): Promise<string[]> {
  let recoveryCodes: string[] = [];

  await db.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    recoveryCodes = generateRecoveryCodes(updatedUser) ?? [];

    if (recoveryCodes.length === 0) {
      throw new AuthError('MISSING_BACKUP_CODE');
    }

    await tx.userRecoveryCode.createMany({
      data: recoveryCodes.map((code) => ({ userId, code })),
    });
  });

  return recoveryCodes;
}



// FP: single write per code path — audit log in failure branch, passkey update on success
declare const db: {
  userSecurityAuditLog: { create(args: any): Promise<any> };
  passkey: { update(args: any): Promise<any> };
};
declare class AppError extends Error { constructor(code: string); }

export async function verifyPasskeyAuthentication(
  userId: number,
  passkeyId: string,
  counter: number,
  isValid: boolean,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (!isValid) {
    // Failure branch: one audit log write, then throw
    await db.userSecurityAuditLog.create({
      data: {
        userId,
        ipAddress,
        userAgent,
        type: 'SIGN_IN_PASSKEY_FAIL',
      },
    });

    throw new AppError('INVALID_REQUEST');
  }

  // Happy path: one passkey update write
  await db.passkey.update({
    where: { id: passkeyId },
    data: {
      lastUsedAt: new Date(),
      counter,
    },
  });
}



// FP: tx.user.create inside prisma.$transaction — already in transaction (OAuth callback)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function provisionOAuthUser(
  email: string,
  name: string,
  provider: string,
  providerAccountId: string,
): Promise<any> {
  return await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        emailVerified: new Date(),
      },
    });

    await tx.account.create({
      data: {
        userId: user.id,
        provider,
        providerAccountId,
        type: 'oauth',
      },
    });

    return user;
  });
}



// FP: writes are on mutually exclusive code paths — delete on happy path, audit log create in failure branch
declare const db: {
  anonymousVerificationToken: { delete(args: any): Promise<any> };
  userSecurityAuditLog: { create(args: any): Promise<any> };
  passkey: { update(args: any): Promise<any> };
};
declare class AppError extends Error { constructor(code: string); }

export async function authenticateWithPasskey(
  csrfToken: string,
  passkeyId: string,
  userId: number,
  isValid: boolean,
  counter: number,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  // Happy path: delete the challenge token (single write on this path)
  const challengeToken = await db.anonymousVerificationToken
    .delete({ where: { id: csrfToken } })
    .catch(() => null);

  if (!challengeToken || !isValid) {
    // Failure path: one audit log write then throw — mutually exclusive with the passkey update below
    await db.userSecurityAuditLog.create({
      data: { userId, ipAddress, userAgent, type: 'SIGN_IN_PASSKEY_FAIL' },
    });
    throw new AppError('INVALID_REQUEST');
  }

  // Success path: update passkey counter
  await db.passkey.update({
    where: { id: passkeyId },
    data: { lastUsedAt: new Date(), counter },
  });
}
