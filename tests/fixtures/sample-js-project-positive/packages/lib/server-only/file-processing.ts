
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Buffer.from(await arrayBuffer())) ---
interface UploadedFile {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  type: string;
}
declare function normalizePdf(buf: Buffer, opts: { flattenForm: boolean }): Promise<Buffer>;
declare function storePdfFile(opts: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ fileId: string; pageCount: number }>;

export async function processUploadedPdf(uploadedFile: UploadedFile, flattenForm: boolean) {
  let buffer = Buffer.from(await uploadedFile.arrayBuffer());

  const normalized = await normalizePdf(buffer, {
    flattenForm,
  });

  const { fileId, pageCount } = await storePdfFile({
    name: uploadedFile.name,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalized),
  });

  return { fileId, pageCount };
}
