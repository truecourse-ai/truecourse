declare function verifyTotpToken(opts: { user: object; totpCode: string }): Promise<boolean>;
declare function verifyBackupCode(opts: { user: object; backupCode: string }): Promise<boolean>;
declare class AppError extends Error { constructor(code: string) {} }

interface CheckTwoFactorOptions {
  totpCode?: string;
  backupCode?: string;
  user: object;
}

export const checkTwoFactor = async ({ totpCode, backupCode, user }: CheckTwoFactorOptions) => {
  if (totpCode) {
    return await verifyTotpToken({ user, totpCode });
  }

  if (backupCode) {
    return await verifyBackupCode({ user, backupCode });
  }

  throw new AppError('TWO_FACTOR_MISSING_CREDENTIALS');
};
