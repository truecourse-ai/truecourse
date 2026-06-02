// An exported function that no analyzed file imports directly. Its only
// consumer is a sibling `index.ts` barrel that re-exports it for external
// callers (tests, downstream packages) which are outside the analyzed set.
// The export is intentionally part of the directory's public API surface and
// must not be flagged as unused.

function parseQuery(input: string): { ok: boolean } {
  if (!input.trim()) return { ok: true };
  try {
    JSON.parse(input);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function isValidQueryShape(input: string): boolean {
  return parseQuery(input).ok;
}

export function getQueryShapeError(input: string): string | null {
  if (!input.trim()) return null;
  try {
    JSON.parse(input);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "unknown error";
  }
}
