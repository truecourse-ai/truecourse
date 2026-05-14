
declare function saveFormData(data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleAutoSave(data: Record<string, unknown>): Promise<void> {
  try {
    await saveFormData(data);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Error',
      description: 'An error occurred while auto-saving. Please try again.',
      variant: 'destructive',
    });
    throw err;
  }
}



declare function updateSigners(signers: unknown[]): Promise<unknown>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function onAddSigners(signers: unknown[]): Promise<void> {
  try {
    await updateSigners(signers);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Error',
      description: 'An error occurred while adding signers.',
      variant: 'destructive',
    });
    throw err;
  }
}



declare function searchCommands(query: string): Promise<{ id: string; label: string }[]>;
declare function postToParentFrame(data: Record<string, string>): void;

async function handleCommandSearch(query: string): Promise<void> {
  try {
    const results = await searchCommands(query);
    console.log(`Found ${results.length} commands for: ${query}`);
  } catch (e) {
    postToParentFrame({ error: `${e}` });
  }
}



declare function updateDocumentRecipients(documentId: string, recipients: unknown[]): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function onUpdateRecipients(documentId: string, recipients: unknown[]): Promise<void> {
  try {
    await updateDocumentRecipients(documentId, recipients);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Error',
      description: 'An error occurred while updating recipients.',
      variant: 'destructive',
    });
  }
}



declare function autoSaveDocumentFields(documentId: string, fields: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function onAutoSaveFields(documentId: string, fields: Record<string, unknown>): Promise<void> {
  try {
    await autoSaveDocumentFields(documentId, fields);
  } catch (err) {
    console.error(err);
    showToast({
      title: 'Auto-save failed',
      description: 'An error occurred while saving your changes.',
      variant: 'destructive',
    });
  }
}
