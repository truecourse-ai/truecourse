// Negative cases: JSON.parse called on untrusted/unvalidated input outside
// of any try/catch — input may not be valid JSON and the call can throw.

export function readSessionPayload(raw: string): unknown {
  // VIOLATION: reliability/deterministic/unsafe-json-parse
  return JSON.parse(raw);
}

export function decodeStorageEntry(stored: string | null): unknown {
  if (stored === null) return null;
  // VIOLATION: reliability/deterministic/unsafe-json-parse
  return JSON.parse(stored);
}
