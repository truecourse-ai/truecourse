// Directly reads and mutates the global `location` object — there is no
// local binding named `location` in scope, so this is the real restricted
// global usage the rule targets (router navigation should be used instead).
export function goHome(): void {
  // VIOLATION: code-quality/deterministic/restricted-api-usage
  location.href = "/home";
}
