/**
 * Negative fixture for code-quality/deterministic/triple-slash-reference.
 *
 * `/// <reference path="..." />` is the legacy way of pulling in another
 * source file. Modern TypeScript code should use `import` instead.
 */

// VIOLATION: code-quality/deterministic/triple-slash-reference
/// <reference path="./legacy-types.ts" />

export const LEGACY = true;
