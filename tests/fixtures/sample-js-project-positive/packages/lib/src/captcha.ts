
// --- env-in-library-code shape: single-purpose-config-resolver-function ---
// This module is the sole location for captcha verification. Reading the secret
// key from process.env here is intentional — the function is gated by it.
declare function logger_warn(opts: { msg: string; ipAddress?: string | null }): void;
declare class AppError extends Error { constructor(code: string, opts?: { message?: string; statusCode?: number }): AppError; }
declare const AppErrorCode: { INVALID_CAPTCHA: string };

export const verifyCaptchaToken = async ({
  token,
  ipAddress,
}: {
  token?: string | null;
  ipAddress?: string | null;
}): Promise<void> => {
  const secretKey = process.env.APP_CAPTCHA_SECRET_KEY;

  if (!secretKey) {
    return;
  }

  if (!token) {
    logger_warn({ msg: 'Captcha verification rejected: missing token', ipAddress });
    throw new AppError(AppErrorCode.INVALID_CAPTCHA, {
      message: 'Captcha token is required',
      statusCode: 400,
    });
  }
};
