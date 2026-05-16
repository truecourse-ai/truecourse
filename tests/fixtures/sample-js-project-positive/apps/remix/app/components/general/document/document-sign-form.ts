
// Pass-through logging + generic toast: catch param only used as console.error argument
async function handleDocumentSignSubmit(documentId: string): Promise<void> {
  try {
    await submitDocumentSignature(documentId);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Something went wrong', description: 'Please try again later.', variant: 'destructive' });
  }
}

declare function submitDocumentSignature(id: string): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;
