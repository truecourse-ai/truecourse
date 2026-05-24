// True bug pattern: an untagged template literal embeds another
// untagged template literal directly, hiding what's being composed.
// The inner literal should be hoisted to a variable for readability.

export function describeUserRow(name: string, id: number, role: string): string {
  // VIOLATION: code-quality/deterministic/nested-template-literal
  return `user=${`${name}#${id}`} role=${role}`;
}
