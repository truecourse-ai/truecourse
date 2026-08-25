export function describeOwner(name: string): string {
  // VIOLATION: code-quality/deterministic/useless-escape
  return "the owner\'s name is " + name;
}
