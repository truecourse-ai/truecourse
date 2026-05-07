/**
 * PDF parsing inside a loop. `PDFDocument.load(...)` is a STATIC
 * factory on the pdf-lib class, NOT an ORM lazy-load. The rule must
 * not flag it just because some ORM (Prisma here) is imported in the
 * same file.
 *
 * Mirrors documenso's
 *   packages/lib/jobs/definitions/internal/seal-document.handler.ts:219,447
 *   packages/lib/server-only/field/create-envelope-fields.ts:124
 * where `PDF.load(...)` / `PDFDocument.load(...)` from @libpdf/core /
 * @cantoo/pdf-lib produced 3/3 false positives.
 */

// `import type` from @prisma/client is enough for detectOrm to flag
// this file as Prisma-using, which is what makes the rule check `.load()`
// calls in the first place. The FP we're guarding against is the rule
// firing on PDFDocument.load() despite Prisma being unrelated.
import type { } from '@prisma/client';

// Stand-in for @cantoo/pdf-lib's PDFDocument: a class with a static
// .load() factory.
declare class PDFDocument {
  static load(bytes: Uint8Array): PDFDocument;
  readonly pageCount: number;
}

export function countAttachmentPages(attachmentBytes: readonly Uint8Array[]): number {
  // Class.load() on each iteration parses the bytes — it is a static
  // factory call, not an ORM lazy-load, so the rule must not fire.
  let pages = 0;
  for (const bytes of attachmentBytes) pages += PDFDocument.load(bytes).pageCount;
  return pages;
}
