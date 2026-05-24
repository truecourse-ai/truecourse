/**
 * Positive fixture for database/deterministic/missing-transaction.
 *
 * Several common method names from PDF and UI libraries — `destroy()`,
 * `save()`, etc. — collide with ORM verb names but are not DB writes.
 * Real ORM writes always take an options/data argument; the bare
 * zero-argument shape is the giveaway that these are UI/PDF library
 * cleanup calls and not multi-write database operations.
 *
 * The rule should not fire when the only "writes" in a function are
 * zero-argument `destroy()` / `save()` calls on non-ORM objects.
 */

type CanvasStage = { add(layer: unknown): void; destroy(): void };
type CanvasLayer = { destroy(): void };
type PdfDoc = {
  save(): Promise<Uint8Array>;
  reload(bytes: Uint8Array): Promise<void>;
};

declare function makeStage(): CanvasStage;
declare function makeLayer(): CanvasLayer;
declare function loadPdf(): Promise<PdfDoc>;
declare function loadLegacyPdf(): Promise<PdfDoc>;

// Two `destroy()` calls on different non-ORM objects in one function —
// this would currently trip "multiple writes to different tables".
export function teardownCanvasComposition(): void {
  const stage = makeStage();
  const layer = makeLayer();
  stage.add(layer);

  stage.destroy();
  layer.destroy();
}

// `pdfDoc.reload(await legacy.save())` — both `save` and `reload` come
// from pdf-lib, not from an ORM. The `save()` is zero-arg; the only
// argument to `reload` is the awaited bytes.
export async function rehydratePdfFromLegacy(): Promise<void> {
  const pdfDoc = await loadPdf();
  const legacy = await loadLegacyPdf();
  await pdfDoc.reload(await legacy.save());
}
