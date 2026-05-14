
// --- argument-type-mismatch shape: upload helper with file-like object ---
// putNormalizedFile called with an object implementing the file interface; types are correct.
declare function putNormalizedFile(file: { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<{ id: string }>;
declare function insertFormData(pdf: Buffer, formValues: Record<string, string>): Buffer;
declare function getFileBytes(dataId: string): Promise<Buffer>;
async function applyFormValuesToDocument(
  dataId: string,
  fileName: string,
  formValues: Record<string, string>,
): Promise<{ id: string }> {
  const pdfBytes = await getFileBytes(dataId);
  const prefilled = insertFormData(pdfBytes, formValues);
  return await putNormalizedFile({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(prefilled),
  });
}


// argument-type-mismatch FP: array.find() with optional chaining to extract a property — valid, no type mismatch
type UploadedFile = { name: string; documentDataId: string };
type FileMapping = { identifier: string | number | undefined };

export function resolveDocumentDataId(
  uploadedFiles: UploadedFile[],
  mapping: FileMapping,
): string | undefined {
  if (typeof mapping.identifier === 'string') {
    return uploadedFiles.find((file) => file.name === mapping.identifier)?.documentDataId;
  }
  if (typeof mapping.identifier === 'number') {
    return uploadedFiles.at(mapping.identifier)?.documentDataId;
  }
  return uploadedFiles.at(0)?.documentDataId;
}

