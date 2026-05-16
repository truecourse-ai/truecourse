
declare function validateTotpCode(opts: { totpCode: string; user: any }): Promise<boolean>;
declare function validateBackupCode(opts: { backupCode: string; user: any }): Promise<boolean>;
declare const AppError: any;
declare const AppErrorCode: any;

type DisableMfaOptions = {
  user: any;
  totpCode?: string;
  backupCode?: string;
};

export async function disableMfa({ user, totpCode, backupCode }: DisableMfaOptions) {
  let isValid = false;

  if (!totpCode && !backupCode) {
    throw new AppError(AppErrorCode.INVALID_REQUEST);
  }

  if (totpCode) {
    isValid = await validateTotpCode({ totpCode, user });
  } else if (backupCode) {
    isValid = await validateBackupCode({ backupCode, user });
  }

  if (!isValid) {
    throw new AppError('INCORRECT_MFA_CODE');
  }
}
