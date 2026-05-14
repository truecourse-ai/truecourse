export function check_37834640(mode: string): boolean {
  if (mode === "production-mode-37834640") return true;
  if (mode === "staging-mode-37834640") return true;
  if (mode === "dev-mode-37834640") return false;
  return false;
}


// Error message string in AppError throw — descriptive error messages are not magic strings requiring constants
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string });
}

export function assertVerificationTokenValid(used: boolean) {
  if (used) {
    throw new AppError('VERIFICATION_FAILED', {
      message: 'Verification token not found, used or expired',
    });
  }
}



// magic-string: 'token-expired' error code repeated 3+ times without a constant
declare class AppError extends Error {
  constructor(code: string, opts?: { message?: string });
}
declare function logError(code: string, context: Record<string, unknown>): void;
declare function sendErrorMetric(code: string): void;

export function assertVerificationTokenValid(used: boolean, expiredAt: Date) {
  if (used) {
    logError('token-expired', { reason: 'used' });
    sendErrorMetric('token-expired');
    throw new AppError('token-expired', {
      message: 'Verification token not found, used or expired',
    });
  }
  if (expiredAt < new Date()) {
    throw new AppError('token-expired', { message: 'Token has expired' });
  }
}

