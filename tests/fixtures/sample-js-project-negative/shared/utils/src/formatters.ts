// VIOLATION: code-quality/deterministic/missing-boundary-types
// VIOLATION: code-quality/deterministic/missing-return-type
export function formatUser(user: any) {
  return {
    // VIOLATION: code-quality/deterministic/unsafe-any-usage
    id: user.id,
    // VIOLATION: code-quality/deterministic/unsafe-any-usage
    name: user.name,
    // VIOLATION: code-quality/deterministic/unsafe-any-usage
    email: user.email,
    // VIOLATION: code-quality/deterministic/unsafe-any-usage
    displayName: `${user.name} <${user.email}>`,
    // VIOLATION: code-quality/deterministic/unsafe-any-usage
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}
