
// [unknown-catch-variable] catch(error) — instanceof AppError guard before re-throw; else new AppError
declare class AppError extends Error { code: string; static create(code: string, message: string): AppError }
declare function updateEmbeddingDocument(opts: { documentId: string; changes: object }): Promise<void>;

async function patchEmbeddingDocument(documentId: string, changes: object): Promise<void> {
  try {
    await updateEmbeddingDocument({ documentId, changes });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.create('INTERNAL_ERROR', 'Failed to update embedding document');
  }
}
