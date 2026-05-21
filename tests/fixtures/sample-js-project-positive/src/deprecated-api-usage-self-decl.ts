/**
 * Positive fixture for code-quality/deterministic/deprecated-api-usage.
 *
 * Declaration-site self-flag: an `export const` whose own JSDoc carries the
 * `@deprecated` tag should be recognized as the DEFINITION of the deprecated
 * symbol — not a *usage* of it. The visitor previously stored declaration
 * nodes in a `Set<SyntaxNode>`, but web-tree-sitter returns fresh wrapper
 * objects for repeated traversal, so reference-based `Set.has` always missed
 * and the identifier at the declaration site got flagged.
 */

declare function readSetting(name: string): string | undefined;

/**
 * Temporary flag to toggle between legacy and modern rendering during rollout.
 *
 * @deprecated Will be removed once the modern pipeline ships.
 */
export const USE_LEGACY_RENDER = (): boolean => readSetting('USE_LEGACY_RENDER') === 'true';
