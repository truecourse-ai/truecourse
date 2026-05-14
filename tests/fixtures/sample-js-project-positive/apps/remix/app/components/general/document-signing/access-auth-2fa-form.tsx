
// [unknown-catch-variable] catch(error) — never accessed; fixed toast shown in 2FA form
declare function verifyTwoFactorCode(opts: { documentId: string; code: string }): Promise<{ verified: boolean }>;
declare const documentId: string;
declare const twoFaToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleTwoFactorVerification(code: string): Promise<boolean> {
  try {
    const { verified } = await verifyTwoFactorCode({ documentId, code });
    return verified;
  } catch (error) {
    twoFaToast({
      title: 'Verification failed',
      description: 'An error occurred while verifying your code. Please try again.',
      variant: 'destructive',
    });
    return false;
  }
}



// [unknown-catch-variable] catch(error) — never referenced; only generic toast (second 2FA handler)
declare function validateBackupCode(opts: { documentId: string; backupCode: string }): Promise<{ valid: boolean }>;
declare const documentId: string;
declare const backupToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleBackupCodeVerification(backupCode: string): Promise<boolean> {
  try {
    const { valid } = await validateBackupCode({ documentId, backupCode });
    return valid;
  } catch (error) {
    backupToast({
      title: 'Verification error',
      description: 'We could not verify your backup code. Please try again.',
      variant: 'destructive',
    });
    return false;
  }
}
