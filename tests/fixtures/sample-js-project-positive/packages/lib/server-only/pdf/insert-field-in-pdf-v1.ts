
// [unknown-catch-variable] catch(err) — never accessed; alternative processing branch runs
declare function renderFieldOverlay(pdfBytes: Uint8Array, fieldSpec: { page: number; x: number; y: number; value: string }): Promise<Uint8Array>;
declare function renderFieldFallback(pdfBytes: Uint8Array, fieldSpec: { page: number; x: number; y: number; value: string }): Promise<Uint8Array>;

async function insertFieldIntoPdf(
  pdfBytes: Uint8Array,
  fieldSpec: { page: number; x: number; y: number; value: string },
): Promise<Uint8Array> {
  try {
    return await renderFieldOverlay(pdfBytes, fieldSpec);
  } catch (err) {
    return await renderFieldFallback(pdfBytes, fieldSpec);
  }
}
