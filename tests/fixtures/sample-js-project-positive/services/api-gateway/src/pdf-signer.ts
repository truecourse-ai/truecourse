/**
 * Shape 3: PDF document signing via `pdf.sign({...})` from a PDF
 * library. Single-arg call shaped like jwt.sign but is PKCS7
 * document signing. The file imports NO JWT library — the rule's
 * import gate must filter this out.
 *
 * Mirrors documenso's packages/signing/index.ts:45.
 */

interface PdfDocument {
  sign(options: { reason: string; location: string }): Promise<{ bytes: Uint8Array }>;
}

export async function signPdf(pdf: PdfDocument): Promise<Uint8Array> {
  const { bytes } = await pdf.sign({
    reason: 'Signed by Sample',
    location: 'Sample location',
  });
  return bytes;
}
