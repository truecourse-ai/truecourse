
// AppError.parseError normalization: immediately normalizes err then checks error.code for typed access
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function moveDocumentToFolder(docId: string, folderId: string): Promise<void>;

async function handleMoveToFolder(docId: string, folderId: string): Promise<void> {
  try {
    await moveDocumentToFolder(docId, folderId);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    if (error.code === 'FOLDER_NOT_FOUND') {
      showNotification({ title: 'Folder no longer exists', variant: 'destructive' });
    } else {
      showNotification({ title: 'Could not move document', variant: 'destructive' });
    }
  }
}
