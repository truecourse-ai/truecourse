// Typed function call with arrayBuffer async lambda — no type mismatch.
interface FileUploadInput {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}
declare function uploadFile(input: FileUploadInput): Promise<{ url: string }>;

async function storeDocumentPdf(name: string, pdfBytes: Uint8Array): Promise<string> {
  const result = await uploadFile({
    name,
    type: 'application/pdf',
    arrayBuffer: async () => pdfBytes.buffer as ArrayBuffer,
  });
  return result.url;
}
