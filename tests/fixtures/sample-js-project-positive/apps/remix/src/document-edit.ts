
declare function updateDocument(documentId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleDocumentUpdate(documentId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateDocument(documentId, data);
    showToast({ title: 'Document updated', description: 'Changes saved successfully.' });
  } catch (err) {
    console.error('Error updating document:', err);
    showToast({
      title: 'Error',
      description: 'An error occurred while updating the document.',
      variant: 'destructive',
    });
  }
}
