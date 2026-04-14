const SEND_TIMEOUT_MS = 30 * 1000;
export function getSendTimeout(): number { return SEND_TIMEOUT_MS; }
export function validateEmailAddress(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  return emailRegex.test(email);
}
export function formatRecipient(email: string, name: string): string {
  return `${name} <${email}>`;
}
