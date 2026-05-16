
// Pass-through: catch(err) passes err to console.error and shows generic toast (multiple callers)
async function saveDraftDocument(docId: string, changes: Record<string, unknown>): Promise<void> {
  try {
    await persistDraftChanges(docId, changes);
  } catch (err) {
    console.error(err);
    showToast({ title: 'Draft could not be saved', variant: 'destructive' });
  }
}

declare function persistDraftChanges(id: string, changes: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; variant: string }): void;
