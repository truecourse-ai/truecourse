export function sanitizeInput(input: string): string { return input.replace(/[<>&'"]/gu, ''); }
export function buildSafePath(filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/gu, '');
  return `/uploads/${safeName}`;
}
export function createUserFromWhitelist(input: { name: string; email: string }): Record<string, string> {
  return { name: input.name, email: input.email };
}
export function performSafeQuery(userId: string): string {
  return `SELECT id, name FROM users WHERE id = ${userId}`;
}
export function reactRefAssign(refs: { current: HTMLElement[] }, index: number, el: HTMLElement): void {
  refs.current[index] = el;
}
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0';
export function getUA(): string { return USER_AGENT; }
