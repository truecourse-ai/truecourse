
declare function pMap<T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>, options?: { concurrency?: number }): Promise<R[]>;
declare const pdfDoc: { numPages: number; getPage: (n: number) => Promise<{ render: () => Promise<Uint8Array> }> };

async function renderAllPages(): Promise<Uint8Array[]> {
  return await pMap(
    Array.from({ length: pdfDoc.numPages }),
    async (_, index) => {
      const page = await pdfDoc.getPage(index + 1);
      return await page.render();
    },
    { concurrency: 2 },
  );
}



// --- FP shape: for-of loop awaiting embedPage on shared outputDoc (page-order-dependent) ---
declare const outputDoc: { embedPage(page: unknown): Promise<unknown>; save(): Promise<Uint8Array> };
declare function loadPageBytes(bytes: Uint8Array): Promise<{ getPage(n: number): unknown; getPageCount(): number }>;
declare const pageBuffers: Uint8Array[];

async function buildPartialPdf(): Promise<Uint8Array> {
  for (const buf of pageBuffers) {
    const loaded = await loadPageBytes(buf);
    const page = loaded.getPage(0);
    await outputDoc.embedPage(page);
  }
  return outputDoc.save();
}



// --- FP shape: intra-iteration dep + shared state — insertField result immediately embedded into shared pdfDoc ---
declare const composedDoc: { embedPage(page: unknown): Promise<unknown>; save(): Promise<Uint8Array> };
declare function renderPageOverlay(fields: Array<{ name: string }>, pageIndex: number): Promise<Uint8Array>;
declare function loadPdfBytes(bytes: Uint8Array): Promise<{ getPage(n: number): unknown }>;
declare const pageGroups: Array<{ fields: Array<{ name: string }>; pageIndex: number }>;

async function composePdfWithOverlays(): Promise<Uint8Array> {
  for (const group of pageGroups) {
    const overlayBytes = await renderPageOverlay(group.fields, group.pageIndex);
    const overlayDoc = await loadPdfBytes(overlayBytes);
    await composedDoc.embedPage(overlayDoc.getPage(0));
  }
  return composedDoc.save();
}



// --- FP shape: PDF.load result passed directly to embedPage in the same iteration ---
declare const targetDoc: { embedPage(page: unknown): Promise<unknown>; save(): Promise<Uint8Array> };
declare function parsePdfBytes(bytes: Uint8Array): Promise<{ getPage(index: number): unknown }>;
declare const overlayBuffers: Uint8Array[];

async function assembleWithOverlays(): Promise<Uint8Array> {
  for (const overlayBuf of overlayBuffers) {
    const overlayDoc = await parsePdfBytes(overlayBuf);
    await targetDoc.embedPage(overlayDoc.getPage(0));
  }
  return targetDoc.save();
}



// --- FP shape: sequential per-page overlay composition into shared document ---
declare const assemblyDoc: { embedPage(page: unknown): Promise<unknown>; save(): Promise<Uint8Array> };
declare function applyPageOverlay(fields: Array<{ id: string }>, pageIndex: number): Promise<Uint8Array>;
declare function parseOverlayPdf(bytes: Uint8Array): Promise<{ getPage(i: number): unknown }>;
declare const fieldGroups: Array<{ fields: Array<{ id: string }>; pageIndex: number }>;

async function buildOverlayedDocument(): Promise<Uint8Array> {
  for (const group of fieldGroups) {
    const overlayBytes = await applyPageOverlay(group.fields, group.pageIndex);
    const overlayPdf = await parseOverlayPdf(overlayBytes);
    await assemblyDoc.embedPage(overlayPdf.getPage(0));
  }
  return assemblyDoc.save();
}



// FP: unwrappedNode.destroy() is a DOM/layout lifecycle call, not a database write
declare const createLayoutNode: (options: any) => any;
declare function computeLayout(node: any): any;

export function renderLayoutToCanvas(options: any): ImageData {
  let unwrappedNode: any = createLayoutNode(options);

  const result = computeLayout(unwrappedNode);

  unwrappedNode.destroy();
  unwrappedNode = null;

  return result;
}
