
// FP: loadedPdf.destroy() is a PDF document lifecycle call, not a database write
declare const pdfjsLib: { getDocument(config: any): { promise: Promise<any> } };
declare function isCancelledRef(): boolean;

export async function loadPdfDocument(
  pdfData: ArrayBuffer,
  onLoad: (doc: any) => void,
): Promise<void> {
  let isCancelled = false;

  const loadedPdf = await pdfjsLib
    .getDocument({ data: pdfData })
    .promise;

  if (isCancelled) {
    await loadedPdf.destroy();
    return;
  }

  onLoad(loadedPdf);
}
