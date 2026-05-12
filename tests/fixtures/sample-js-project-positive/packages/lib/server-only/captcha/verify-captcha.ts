// Server-only captcha verification helper. Reads the Turnstile secret from the
// environment at call time — a legitimate config-presence check that the
// env-in-library-code rule still flags because the file path is under packages/.
declare const process: { env: Record<string, string | undefined> };
declare function fetchTurnstileVerification(token: string, secret: string): Promise<boolean>;

export async function verifyCaptcha(token: string): Promise<boolean> {
  const secretKey = process.env.NEXT_PRIVATE_TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return true;
  }
  return fetchTurnstileVerification(token, secretKey);
}

export function isCaptchaEnabled(): boolean {
  return Boolean(process.env.NEXT_PRIVATE_TURNSTILE_SECRET_KEY);
}
