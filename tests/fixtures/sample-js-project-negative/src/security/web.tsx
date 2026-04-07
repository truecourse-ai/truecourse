/**
 * Security violations that require TSX (JSX elements).
 */

// VIOLATION: security/deterministic/link-target-blank
export function UnsafeLink() {
  return <a href="https://example.com" target="_blank">External</a>;
}
