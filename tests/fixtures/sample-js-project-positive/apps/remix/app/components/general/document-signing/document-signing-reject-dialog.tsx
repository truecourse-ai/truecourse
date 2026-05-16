
// [unknown-catch-variable] catch(err) — never accessed; fixed toast in reject dialog
declare function rejectDocumentSigning(opts: { documentId: string; reason: string }): Promise<void>;
declare const documentId: string;
declare const rejectToast: (opts: { title: string; description: string; variant?: string }) => void;
declare function closeDialog(): void;

async function handleSigningRejection(reason: string): Promise<void> {
  try {
    await rejectDocumentSigning({ documentId, reason });
    rejectToast({ title: 'Document rejected', description: 'The signing request has been declined.' });
    closeDialog();
  } catch (err) {
    rejectToast({
      title: 'Rejection failed',
      description: 'An error occurred while declining the document. Please try again.',
      variant: 'destructive',
    });
  }
}
