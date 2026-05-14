declare function verifyTotpToken(opts: { user: object; totpCode: string }): Promise<boolean>;
declare function verifyBackupToken(opts: { user: object; backupCode: string }): Promise<boolean>;
declare class AppError extends Error { constructor(code: string) {} }

interface ValidateTwoFactorOptions {
  totpCode?: string;
  backupCode?: string;
  user: object;
}

export const validateTwoFactor = async ({ totpCode, backupCode, user }: ValidateTwoFactorOptions) => {
  if (totpCode) {
    return await verifyTotpToken({ user, totpCode });
  }

  if (backupCode) {
    return verifyBackupToken({ user, backupCode });
  }

  throw new AppError('TWO_FACTOR_MISSING_CREDENTIALS');
};
