// The `instanceof`/`typeof` checks and boolean returns here live inside a
// nested callback, not in the outer function's own body. The outer function
// delegates its narrowing to `.some(...)`, so it is NOT a type-guard candidate
// and must NOT trip code-quality/deterministic/type-guard-preference.
export function anyLooksTransient(items: readonly unknown[]): boolean {
  return items.some((result) => {
    if (result instanceof Error) {
      return result.message === "timeout";
    }
    return String(result).length === 0;
  });
}
