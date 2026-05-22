/**
 * Positive fixture for code-quality/deterministic/unused-expression.
 *
 * `namespace X { ... }` is a TypeScript type-level construct, not a
 * runtime expression. It is commonly used inside `declare global { ... }`
 * or `declare module '...' { ... }` to augment ambient or module-scoped
 * types. Tree-sitter wraps the namespace declaration in an
 * `expression_statement`, but it has no runtime side-effect concern — the
 * rule should not fire.
 */

type TFlags = { admin: boolean; viewer: boolean };

declare global {
  namespace AppJson {
    type Flags = TFlags;
  }
}

export type { TFlags };
