/**
 * collapsible-if shape that should NOT fire:
 *
 * Outer (or inner) condition is already multi-line / compound;
 * collapsing into `if (A && B)` produces a single condition with
 * 3+ binary expressions across multiple lines that no human
 * actually wants to read.
 */

declare const apiBase: string;
declare const log: (msg: string) => void;

export function bootstrap(host: string, token: string | null, isAdmin: boolean): void {
  if (
    apiBase.startsWith("https://") &&
    host.includes(".internal.") &&
    !host.endsWith(":443") &&
    token != null &&
    token.length > 0
  ) {
    if (isAdmin && (host === "admin.internal." || host.startsWith("ops."))) {
      log(`bootstrap ${host}`);
    }
  }
}
