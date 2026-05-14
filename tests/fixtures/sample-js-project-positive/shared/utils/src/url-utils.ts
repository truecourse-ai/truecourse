
// Snippet: string array includes with string argument — correct types
declare const VALID_SCHEMES: string[];

export function isAllowedScheme(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (!VALID_SCHEMES.includes(parsed.protocol.slice(0, -1).toLowerCase())) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
