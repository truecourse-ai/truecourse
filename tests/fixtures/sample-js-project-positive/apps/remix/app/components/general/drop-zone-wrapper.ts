
// AppError.parseError normalization: first statement normalizes catch param safely
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function processDroppedFiles(files: FileList): Promise<string[]>;

async function handleDropZoneUpload(files: FileList): Promise<void> {
  try {
    await processDroppedFiles(files);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    showNotification({ title: error.message || 'Upload failed', variant: 'destructive' });
  }
}
