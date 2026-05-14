
declare const logger: { error: (obj: object) => void };
declare function verifyCaptchaToken(token: string): Promise<boolean>;

class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

async function checkCaptcha(token: string): Promise<void> {
  try {
    const valid = await verifyCaptchaToken(token);
    if (!valid) {
      throw new AppError('CAPTCHA_FAILED', 'Captcha verification failed');
    }
  } catch (err) {
    logger.error({ err });
    throw new AppError('CAPTCHA_ERROR', 'An error occurred during captcha verification');
  }
}
