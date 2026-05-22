/**
 * Two FP shapes the visitor previously flagged:
 *
 *  1. `MAP[x as Enum]` — a Record indexed by a value cast to the enum or
 *     string-union the map is keyed by. The cast IS the author asserting
 *     to the type system that the lookup is total over that union; the
 *     visitor only honored an inline `as Record<…>` cast, not the
 *     standard `MAP[k as KeyType]` shape.
 *
 *  2. `arr[idx]` after `if (idx !== -1)`. `Array.prototype.findIndex` and
 *     `indexOf` return -1 on miss, so `idx !== -1` is the canonical bounds
 *     guard for that pattern. The visitor only recognized `.length` and
 *     `in` guards.
 */

type DocumentRole = 'OWNER' | 'EDITOR' | 'VIEWER';

const ROLE_LABELS: Record<DocumentRole, string> = {
  OWNER: 'Owner',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export const describeRole = (raw: unknown): string => {
  return ROLE_LABELS[raw as DocumentRole];
};

interface FieldRow {
  id: string;
  label: string;
}

const fieldRows: FieldRow[] = [];

export const renameField = (
  targetId: string,
  nextLabel: string,
): string | null => {
  const fieldIndex = fieldRows.findIndex((f) => f.id === targetId);
  if (fieldIndex !== -1) {
    const current = fieldRows[fieldIndex];
    return current.label === nextLabel ? current.label : nextLabel;
  }
  return null;
};
