// Imported by ./index.ts (4 usages) and ../client-only/providers/i18n-server.tsx
// dead-module rule fails to traverse relative intra-package specifiers

/**
 * Memoizes the result of a factory function per environment boundary.
 * Prevents re-instantiation on hot-reload in development.
 */
export function remember<T>(name: string, getValue: () => T): T {
  const globalRef = globalThis as Record<string, unknown>;
  if (!globalRef[name]) {
    globalRef[name] = getValue();
  }
  return globalRef[name] as T;
}
