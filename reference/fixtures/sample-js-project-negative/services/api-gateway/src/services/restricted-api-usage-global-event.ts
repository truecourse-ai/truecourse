export function logImplicitGlobalEvent(): string {
  // VIOLATION: code-quality/deterministic/restricted-api-usage
  return String(event);
}
