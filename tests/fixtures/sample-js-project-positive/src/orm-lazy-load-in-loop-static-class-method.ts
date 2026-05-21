// Side-effect import so the analyzer recognizes this file as ORM-using
// (orm-lazy-load-in-loop only fires when an ORM is in scope).
import '@prisma/client';

declare const PdfDocument: {
  load(bytes: Uint8Array): { pageCount: number };
};

declare const ByteSource: {
  from(value: string): Uint8Array;
};

export function summarizeUploads(uploads: ReadonlyArray<{ bytes: Uint8Array }>): number {
  let total = 0;
  for (const upload of uploads) {
    const doc = PdfDocument.load(upload.bytes);
    total += doc.pageCount;
  }
  return total;
}

export function summarizeStrings(values: ReadonlyArray<string>): number {
  let total = 0;
  for (const value of values) {
    const doc = PdfDocument.load(ByteSource.from(value));
    total += doc.pageCount;
  }
  return total;
}
