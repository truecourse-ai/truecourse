
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


// fileRejections.some() with nested .some() checking error code — valid nested predicate, no type mismatch
declare const FileRejectionErrorCode: { TooManyFiles: string; FileTooLarge: string; FileInvalidType: string };

function hasFileSizeRejection(
  fileRejections: Array<{ errors: Array<{ code: string }> }>,
): boolean {
  return fileRejections.some((rejection) =>
    rejection.errors.some((error) => error.code === FileRejectionErrorCode.FileTooLarge),
  );
}

function hasFileCountRejection(
  fileRejections: Array<{ errors: Array<{ code: string }> }>,
): boolean {
  return fileRejections.some((rejection) =>
    rejection.errors.some((error) => error.code === FileRejectionErrorCode.TooManyFiles),
  );
}



// FP: nested .some() predicate — TS flags string/number incompatibility even though logic is correct
function checkDropzoneRejections(rejections: Array<{ errors: Array<{ code: string; count: number }> }>): boolean {
  const limit: number = 5;
  return rejections.some((r) =>
    r.errors.some((e) => e.code === limit),
  );
}

