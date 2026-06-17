/**
 * Realistic event-type service. Settings split across two storage strategies:
 *
 *   - `requiresCancellationReason` is a dedicated schema column (see
 *     schema.prisma) and is read straight off the row.
 *   - `disableGuests` and `hideCalendarNotes` are NOT columns — they live as
 *     keys inside the row's `metadata` JSON blob, read/written through it.
 *
 * The persistence-strategy extractor reconciles these: column-backed fields
 * resolve to `dedicated-column`; metadata-only keys resolve to `metadata-json`.
 */

interface EventTypeRow {
  id: string;
  title: string;
  requiresCancellationReason: boolean;
  slug: string;
  metadata: Record<string, unknown> | null;
}

export interface EventTypeSettings {
  requiresCancellationReason: boolean;
  disableGuests: boolean;
  hideCalendarNotes: boolean;
}

/** Project a stored row into the flat settings the API exposes. */
export function readSettings(row: EventTypeRow): EventTypeSettings {
  const metadata = row.metadata ?? {};
  return {
    // Dedicated column — read directly off the row.
    requiresCancellationReason: row.requiresCancellationReason,
    // Metadata-JSON keys — read off the blob.
    disableGuests: Boolean(metadata.disableGuests),
    hideCalendarNotes: Boolean(metadata["hideCalendarNotes"]),
  };
}

/** Persist updated settings back, folding the JSON-blob settings into metadata. */
export function writeSettings(
  row: EventTypeRow,
  next: EventTypeSettings,
): EventTypeRow {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    ...row,
    requiresCancellationReason: next.requiresCancellationReason,
    metadata: {
      ...metadata,
      disableGuests: next.disableGuests,
      hideCalendarNotes: next.hideCalendarNotes,
    },
  };
}
