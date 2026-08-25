// Negative cases that the rule must still catch — bare template literals
// that wrap a single substitution with no surrounding text.

// VIOLATION: code-quality/deterministic/redundant-template-expression
export function formatLabel(label: string): string {
  return `${label}`;
}

// VIOLATION: code-quality/deterministic/redundant-template-expression
export function formatTag(tag: string): string {
  return `${tag}`;
}
