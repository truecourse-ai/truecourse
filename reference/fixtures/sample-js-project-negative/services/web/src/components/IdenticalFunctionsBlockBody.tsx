// VIOLATION: code-quality/deterministic/identical-functions
export function normalizeSlugA(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const segments = trimmed.split('-');
  return segments.filter(Boolean).join(' ');
}

export function normalizeSlugB(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const segments = trimmed.split('-');
  return segments.filter(Boolean).join(' ');
}
