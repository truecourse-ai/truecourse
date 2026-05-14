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


// Function call with object arg containing name, type, and arrayBuffer — correct property types
declare function putFileToStorage(opts: {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}): Promise<{ fileId: string; url: string }>;

declare const uploadedFile: { name: string; arrayBuffer: () => Promise<ArrayBuffer> };

export async function storeUploadedPdf(): Promise<{ fileId: string; url: string }> {
  return putFileToStorage({
    name: uploadedFile.name,
    type: 'application/pdf',
    arrayBuffer: async () => uploadedFile.arrayBuffer(),
  });
}

