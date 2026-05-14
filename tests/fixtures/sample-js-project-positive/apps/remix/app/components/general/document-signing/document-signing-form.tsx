declare function navigate(delta: number): void;
declare const window: Window & { history: { length: number } };

const SigningFormActions = () => {
  return (
    <div>
      <button
        type="button"
        disabled={typeof window !== 'undefined' && window.history.length <= 1}
        onClick={async () => navigate(-1)}
      >
        Cancel
      </button>
    </div>
  );
};



// [unknown-catch-variable] catch(err) — never accessed; shows fixed toast in signing form
declare function submitSignaturePacket(opts: { documentId: string; fields: unknown[] }): Promise<void>;
declare const signingToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const documentId: string;
declare const collectedFields: unknown[];

async function finalizeDocumentSigning(): Promise<void> {
  try {
    await submitSignaturePacket({ documentId, fields: collectedFields });
    signingToast({ title: 'Document signed', description: 'The document has been successfully signed.' });
  } catch (err) {
    signingToast({
      title: 'Signing failed',
      description: 'An error occurred while signing. Please try again.',
      variant: 'destructive',
    });
  }
}
