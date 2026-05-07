/**
 * Global-augmentation file. `declare global { var ... }` REQUIRES `var`
 * — TypeScript explicitly does not allow `let` or `const` for global
 * augmentation because only `var` declarations bind to `globalThis`.
 *
 * The js-style-preference rule must NOT flag `var` inside an
 * `ambient_declaration` (`declare global { ... }`,
 * `declare module 'x' { ... }`, etc.).
 *
 * Mirrors documenso's
 *   packages/lib/utils/remember.ts
 *   packages/lib/jobs/client/bullmq.ts
 *   packages/lib/server-only/license/license-client.ts
 *   packages/prisma/utils/remember.ts
 * which all carry an `// eslint-disable-next-line no-var` precisely
 * because the project recognises this is a forced exception.
 */

declare global {
  // eslint-disable-next-line no-var
  var __sample_remember_cache: Map<string, unknown>;
}

export function rememberInit(name: string, value: unknown): void {
  if (!globalThis.__sample_remember_cache) {
    globalThis.__sample_remember_cache = new Map();
  }
  globalThis.__sample_remember_cache.set(name, value);
}
