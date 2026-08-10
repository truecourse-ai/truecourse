// Negative cases that the rule must still catch — canonical nested
// quantifiers on a single atom (character class, wildcard, escape).

// VIOLATION: bugs/deterministic/redos-vulnerable-regex
export function matchesNestedCharClass(input: string): boolean {
  return /^([a-z]+)+$/.test(input);
}

// VIOLATION: bugs/deterministic/redos-vulnerable-regex
export function matchesNestedWildcard(input: string): boolean {
  return /^(.*)+$/.test(input);
}
