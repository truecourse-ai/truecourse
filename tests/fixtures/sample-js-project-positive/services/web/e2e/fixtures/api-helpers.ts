/**
 * Playwright e2e fixture helpers. Consumed by spec files
 * (`*.spec.ts` / `*.test.ts`) which the analyzer doesn't traverse,
 * so the unused-export rule should NOT fire on these exports.
 */

export function apiSignout(token: string): string {
  return `signout:${token}`;
}

export function checkSessionValid(token: string): boolean {
  return token.length > 0;
}
