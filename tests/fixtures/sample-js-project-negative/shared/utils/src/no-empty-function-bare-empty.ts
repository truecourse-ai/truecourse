// A standalone empty function with no parameter properties, no
// `// intentionally empty` comment, and no enclosing-arg / JSX /
// fallback context is the canonical "did you forget the body?" case
// the rule must flag.

// VIOLATION: code-quality/deterministic/no-empty-function
export function reservedHook(): void {}

export class Plain {
  // VIOLATION: code-quality/deterministic/no-empty-function
  noop(): void {}
}
