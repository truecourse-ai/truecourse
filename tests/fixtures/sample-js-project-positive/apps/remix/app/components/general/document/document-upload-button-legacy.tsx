
// [unknown-catch-variable] catch(err) — narrowed via AppError.parseError; typed error then accessed
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare function uploadDocumentFile(file: File): Promise<{ fileId: string }>;
declare const uploadToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleDocumentUpload(file: File): Promise<string | null> {
  try {
    const { fileId } = await uploadDocumentFile(file);
    return fileId;
  } catch (err) {
    const parsedError = AppError.parseError(err);
    uploadToast({
      title: 'Upload failed',
      description: parsedError.message,
      variant: 'destructive',
    });
    return null;
  }
}
