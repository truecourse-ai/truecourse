
// Wave-M07: Buffer.from(Uint8Array) — correct overload, no type mismatch
declare function processPdfBytes(): Promise<Uint8Array>;

async function convertPdfToBuffer(): Promise<Buffer> {
  const pdfBytes = await processPdfBytes();
  return Buffer.from(pdfBytes);
}



// Wave-M41: arrayBuffer: async () => Promise.resolve(Buffer.from(Uint8Array)) — wraps correctly typed buffer
declare function saveDocument(): Promise<Uint8Array>;
declare function uploadFile(opts: { name: string; type: string; arrayBuffer: () => Promise<Buffer> }): Promise<{ id: string }>;

async function persistModifiedDocument() {
  const modifiedBytes = await saveDocument();
  const { id: documentDataId } = await uploadFile({
    name: 'document.pdf',
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(Buffer.from(modifiedBytes)),
  });
  return documentDataId;
}



// ce9d00f6426d: Buffer.from(arrayBuffer) passed to processing function with options object
declare function normalizeDocument(buffer: Buffer, opts: { flattenAnnotations?: boolean; removeMetadata?: boolean }): Promise<Buffer>;
declare const rawBuffer: ArrayBuffer;

async function processDocumentBuffer(): Promise<Buffer> {
  return normalizeDocument(Buffer.from(rawBuffer), { flattenAnnotations: true, removeMetadata: false });
}



// Buffer.from wrapping a fetched ArrayBuffer-like value
declare function fetchFileData(dataId: string): Promise<ArrayBuffer>;
declare function processPdfBytes(pdf: Buffer, options: Record<string, unknown>): Promise<Buffer>;

async function transformPdfDocument(dataId: string, options: Record<string, unknown>): Promise<Buffer> {
  const raw = await fetchFileData(dataId);
  const result = await processPdfBytes(
    Buffer.from(raw),
    options,
  );
  return result;
}



// await function({ pdf: Buffer.from(pdf), ...rest })
declare function getFileBytes(dataId: string): Promise<ArrayBuffer>;
declare interface FormValues { [key: string]: string | boolean | number; }
declare function insertFormValues(opts: { pdf: Buffer; formValues: FormValues }): Promise<Buffer>;

async function applyFormValuesToPdf(dataId: string, formValues: FormValues): Promise<Buffer> {
  const rawPdf = await getFileBytes(dataId);
  const prefilled = await insertFormValues({
    pdf: Buffer.from(rawPdf),
    formValues,
  });
  return prefilled;
}



// --- FP shape: for-of loop where getFile result immediately feeds next await in same iteration ---
declare function fetchFileBytes(fileId: string): Promise<Uint8Array>;
declare function extractFieldsFromBytes(bytes: Uint8Array, opts: { recipientId: string }): Promise<Array<{ name: string }>>;
declare function assignRecipientFields(recipientId: string, fields: Array<{ name: string }>): Promise<void>;
declare const envelopeItems: Array<{ fileId: string; recipientId: string }>;

async function detectAndAssignFields(): Promise<void> {
  for (const item of envelopeItems) {
    const fileBytes = await fetchFileBytes(item.fileId);
    const fields = await extractFieldsFromBytes(fileBytes, { recipientId: item.recipientId });
    await assignRecipientFields(item.recipientId, fields);
  }
}



// --- FP shape: outer for-of loop sequential; inner Promise.all parallelises per-item work ---
declare function resolveFieldContext(fieldId: string): Promise<{ label: string; type: string }>;
declare function updateRecipientProgress(recipientId: string, progress: number): Promise<void>;
declare const envelopeItems: Array<{ recipientId: string; fieldIds: string[] }>;

async function resolveAllFieldContexts(): Promise<void> {
  for (const item of envelopeItems) {
    const fieldContexts = await Promise.all(
      item.fieldIds.map((id) => resolveFieldContext(id))
    );
    await updateRecipientProgress(item.recipientId, fieldContexts.length);
  }
}



// --- FP shape: await result consumed by same-iteration Promise.all (intra-iteration dependency) ---
declare function analyzeDocumentFields(fileBytes: Uint8Array): Promise<Array<{ id: string; type: string }>>;
declare function enrichFieldWithContext(field: { id: string; type: string }): Promise<{ id: string; type: string; label: string }>;
declare const documentBuffers: Array<{ bytes: Uint8Array; docId: string }>;

async function analyzeAndEnrichAll(): Promise<void> {
  for (const doc of documentBuffers) {
    const rawFields = await analyzeDocumentFields(doc.bytes);
    const enriched = await Promise.all(rawFields.map((f) => enrichFieldWithContext(f)));
    console.log(doc.docId, enriched.length);
  }
}



// --- FP shape: awaited result merged into accumulator declared outside loop each iteration ---
declare function extractRecipients(fileBytes: Uint8Array): Promise<Array<{ email: string; name: string }>>;
declare function mergeRecipients(existing: Array<{ email: string; name: string }>, newOnes: Array<{ email: string; name: string }>): Array<{ email: string; name: string }>;
declare const documentBuffers2: Uint8Array[];

async function collectAllRecipients(): Promise<Array<{ email: string; name: string }>> {
  let allRecipients: Array<{ email: string; name: string }> = [];
  for (const buf of documentBuffers2) {
    const found = await extractRecipients(buf);
    allRecipients = mergeRecipients(allRecipients, found);
  }
  return allRecipients;
}



// --- FP shape: existing fields fetched and immediately fed into detect call in same iteration ---
declare function fetchExistingFields(recipientId: string): Promise<Array<{ id: string; type: string }>>;
declare function detectAdditionalFields(
  fileBytes: Uint8Array,
  existingFields: Array<{ id: string; type: string }>,
  opts: { recipientId: string }
): Promise<Array<{ name: string; type: string }>>;
declare function updateRecipientFieldProgress(recipientId: string, count: number): void;
declare const workItems: Array<{ recipientId: string; fileBytes: Uint8Array }>;

async function detectFieldsIncremental(): Promise<void> {
  for (const item of workItems) {
    const existingFields = await fetchExistingFields(item.recipientId);
    const newFields = await detectAdditionalFields(item.fileBytes, existingFields, { recipientId: item.recipientId });
    updateRecipientFieldProgress(item.recipientId, newFields.length);
  }
}



// --- FP shape: getFile result immediately used as argument to detect call in same loop iteration ---
declare function fetchDocumentBytes(docId: string): Promise<Uint8Array>;
declare function detectDocumentRecipients(bytes: Uint8Array, opts: { docId: string }): Promise<Array<{ email: string }>>;
declare function mergeDocumentRecipients(acc: Array<{ email: string }>, found: Array<{ email: string }>): Array<{ email: string }>;
declare const documentIds2: string[];

async function collectAllDocumentRecipients(): Promise<Array<{ email: string }>> {
  let allRecipients: Array<{ email: string }> = [];
  for (const docId of documentIds2) {
    const bytes = await fetchDocumentBytes(docId);
    const found = await detectDocumentRecipients(bytes, { docId });
    allRecipients = mergeDocumentRecipients(allRecipients, found);
  }
  return allRecipients;
}



// --- void-zero-argument FP shape: promise-chain-void-discard (cleanup in finally) ---
// void pdfDoc.destroy().catch(console.error) is intentional fire-and-forget cleanup in finally block
declare function loadPdfDocument(buffer: Buffer): Promise<{ destroy: () => Promise<void>; pageCount: number }>;

async function convertPdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  const pdfDoc = await loadPdfDocument(pdfBuffer);
  try {
    const pages: string[] = [];
    for (let i = 0; i < pdfDoc.pageCount; i++) {
      pages.push(`page-${i}.png`);
    }
    return pages;
  } finally {
    void pdfDoc.destroy().catch(console.error);
  }
}



declare function findTextOnPage(pattern: RegExp, pageContent: string): { x: number; y: number }[];

const PLACEHOLDER_REGEX = /\{\{([^}]+)\}\}/g;

export function locatePlaceholders(pageContent: string): { x: number; y: number }[] {
  return findTextOnPage(PLACEHOLDER_REGEX, pageContent);
}



// Error unused: catch(err) where err is never accessed; fallback value built independently
function applyFontStyleToCanvas(canvas: CanvasState, fontName: string): string {
  let fontStyle = '12pt Helvetica';
  try {
    setCanvasFont(canvas, fontName, 12);
    fontStyle = \`12pt \${fontName}\`;
  } catch (err) {
    // font unavailable; build fallback DA string without accessing err
    fontStyle = '/Helv 12 Tf 0 g';
  }
  return fontStyle;
}

interface CanvasState { ctx: unknown; }
declare function setCanvasFont(canvas: CanvasState, font: string, size: number): void;
