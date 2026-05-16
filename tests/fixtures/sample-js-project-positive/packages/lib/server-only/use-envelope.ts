declare function processUploadedFile(fileId: string): Promise<{ pages: number; sizeBytes: number }>;
declare function extractFileMetadata(fileId: string): Promise<{ name: string; mime: string }>;

export async function prepareEnvelopeFile(fileId: string) {
  const [processed, metadata] = await Promise.all([
    processUploadedFile(fileId),
    extractFileMetadata(fileId),
  ]);
  return { ...processed, ...metadata };
}
