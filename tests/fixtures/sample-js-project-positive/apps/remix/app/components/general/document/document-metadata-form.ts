
// Pass-through: catch(err) passes err to console.error and shows generic toast
async function saveDocumentMetadata(docId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await persistDocumentMetadata(docId, metadata);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Could not save document', description: 'Please try again.', variant: 'destructive' });
  }
}

declare function persistDocumentMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;
