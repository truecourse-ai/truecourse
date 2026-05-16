declare function validateTwoFactorCode(opts: { totpCode?: string; backupCode?: string; user: object }): Promise<boolean>;
declare class AppError extends Error { constructor(code: string) {} }

interface DisableTwoFactorOptions {
  totpCode?: string;
  backupCode?: string;
  user: object;
}

export const disableTwoFactor = async ({ totpCode, backupCode, user }: DisableTwoFactorOptions) => {
  let isValid = false;

  if (!totpCode && !backupCode) {
    throw new AppError('INVALID_REQUEST');
  }

  if (totpCode) {
    isValid = await validateTwoFactorCode({ totpCode, user });
  } else if (backupCode) {
    isValid = await validateTwoFactorCode({ backupCode, user });
  }

  if (!isValid) {
    throw new AppError('INCORRECT_TWO_FACTOR_CODE');
  }

  return true;
};
