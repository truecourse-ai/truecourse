
// AppError.parseError normalization: immediately normalizes error in first catch statement
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function finalizeDocumentSigning(docId: string, signerToken: string): Promise<void>;

async function completeSigningFlow(docId: string, token: string): Promise<void> {
  try {
    await finalizeDocumentSigning(docId, token);
  } catch (error) {
    const parsedError = TypedErrorParser.parseError(error);
    showNotification({ title: parsedError.message || 'Signing failed', variant: 'destructive' });
  }
}
