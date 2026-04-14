export function setupCors(): Record<string, unknown> {
  return { origin: 'https://app.example.com' };
}
export function setSecureCookie(): Record<string, unknown> {
  return { httpOnly: true, secure: true, sameSite: 'strict' };
}
export function productionConfig(): { debug: boolean; logLevel: string } {
  return { debug: false, logLevel: 'error' };
}
