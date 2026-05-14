
// [unknown-catch-variable] catch(err) — AppError.parseError + match() on typed code; properly guarded
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare const match: <T>(val: T) => { with(pattern: T, fn: () => string): { otherwise(fn: () => string): string } };
declare function uploadEnvelopeFile(file: File): Promise<{ fileId: string }>;
declare const dropZoneToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleEnvelopeFileDrop(file: File): Promise<string | null> {
  try {
    const { fileId } = await uploadEnvelopeFile(file);
    return fileId;
  } catch (err) {
    const error = AppError.parseError(err);
    const description = match(error.code)
      .with('FILE_TYPE_UNSUPPORTED', () => 'This file type is not supported.')
      .otherwise(() => error.message);
    dropZoneToast({ title: 'Upload failed', description, variant: 'destructive' });
    return null;
  }
}
