
// --- no-void shape: void-with-promise-chain (void doc.destroy().catch(console.error) — discard outer, keep error handler) ---
declare function createPdfDocument(src: string): Promise<{ destroy: () => Promise<void>; pageCount: number }>;

async function extractPageCount(pdfSrc: string): Promise<number> {
  let doc: { destroy: () => Promise<void>; pageCount: number } | null = null;
  try {
    doc = await createPdfDocument(pdfSrc);
    return doc.pageCount;
  } finally {
    if (doc) {
      void doc.destroy().catch(console.error);
    }
  }
}
