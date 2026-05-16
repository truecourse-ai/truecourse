
// FP: PDFDocument.load() is a PDF library call, not a database operation
declare const PDFDocument: { load(data: Uint8Array): Promise<any> };
declare function serializeDoc(doc: any): Promise<Uint8Array>;

export async function flattenPdfForm(pdfBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);

  pdfDoc.getForm().flatten();

  return await serializeDoc(pdfDoc);
}



// FP: pdf.destroy() is a PDF object lifecycle call, not a database write
declare const pdfjs: { getDocument(src: any): { promise: Promise<any> } };
declare function renderPageToImage(page: any, scale: number): Promise<string>;

export async function extractPdfPageImages(
  pdfBytes: Uint8Array,
  scale = 2,
): Promise<string[]> {
  const pdf = await pdfjs.getDocument({ data: pdfBytes }).promise;
  const images: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const image = await renderPageToImage(page, scale);
    images.push(image);
    void page.cleanup();
  }

  void pdf.destroy().catch((e: unknown) => console.error(e));

  return images;
}



// FP: pdfDoc.reload() is a PDF document method call, not a database operation
declare const PDFDocument: { load(data: Uint8Array): Promise<any> };
declare function serializeDoc(doc: any): Promise<Uint8Array>;
declare function flattenLegacyFields(legacyDoc: any, fields: any[]): void;

export async function insertLegacyFieldsIntoPdf(
  pdfBytes: Uint8Array,
  legacyFields: any[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const legacyPdfDoc = await PDFDocument.load(await serializeDoc(pdfDoc));

  flattenLegacyFields(legacyPdfDoc, legacyFields);
  legacyPdfDoc.getForm().flatten();

  // Reload the main doc with the flattened legacy insertions
  await pdfDoc.reload(await serializeDoc(legacyPdfDoc));

  return await serializeDoc(pdfDoc);
}



declare const PdfDocument: { load: (bytes: Uint8Array) => Promise<any> };
declare function fetchFileBytes(url: string): Promise<Uint8Array>;

interface AttachmentItem {
  id: string;
  url: string;
  mimeType: string;
}

// Loads each attachment PDF into an in-memory cache for subsequent page manipulation.
// PDF.load() is a binary-parsing call, not an ORM query — no database round-trip occurs.
export async function buildPdfCache(attachments: AttachmentItem[]): Promise<Map<string, any>> {
  const pdfCache = new Map<string, any>();

  for (const attachment of attachments) {
    const bytes = await fetchFileBytes(attachment.url);
    const doc = await PdfDocument.load(new Uint8Array(bytes));
    pdfCache.set(attachment.id, doc);
  }

  return pdfCache;
}



declare const PdfLib: { load: (bytes: Uint8Array) => Promise<any> };

interface PdfData {
  id: string;
  bytes: Uint8Array;
}

// pdfDataList was pre-fetched outside the loop via Promise.all.
// PDF.load() here parses in-memory binary data — no ORM/DB operation.
export async function parsePreFetchedPdfs(pdfDataList: PdfData[]): Promise<Map<string, any>> {
  const parsed = new Map<string, any>();

  for (const pdfData of pdfDataList) {
    const doc = await PdfLib.load(new Uint8Array(pdfData.bytes));
    parsed.set(pdfData.id, doc);
  }

  return parsed;
}



declare const PdfEngine: { load: (bytes: Uint8Array) => Promise<any> };

interface OverlayEntry {
  pageNumber: number;
  overlayBytes: Uint8Array;
}

// Iterates PDF pages grouped by page number to embed overlays.
// PdfEngine.load() is an in-memory PDF parsing call, not an ORM query.
export async function embedOverlaysByPage(entries: OverlayEntry[]): Promise<void> {
  const grouped = new Map<number, OverlayEntry[]>();

  for (const entry of entries) {
    const list = grouped.get(entry.pageNumber) ?? [];
    list.push(entry);
    grouped.set(entry.pageNumber, list);
  }

  for (const [, pageEntries] of grouped) {
    for (const entry of pageEntries) {
      const overlayDoc = await PdfEngine.load(new Uint8Array(entry.overlayBytes));
      // embed overlayDoc into main document at entry.pageNumber
      void overlayDoc;
    }
  }
}
