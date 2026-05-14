
// FP: void handleSync() inside useEffect body — intentional promise discard.
// The effect fires to trigger async sync; void is used to suppress floating promise lint.
declare function useEffect4(fn: () => void | (() => void), deps: unknown[]): void;
declare const isOpen: boolean;
declare const isSyncing: boolean;
declare function handleSync(): Promise<void>;

useEffect4(() => {
  if (isOpen && isSyncing) {
    void handleSync();
  }
}, [isOpen]);



// narrowed-via-parse-wrap-utility: catch(err) immediately wrapped via AppError.parseError; all accesses on typed result
declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare function moveFolderToDestination(folderId: string, destinationId: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleMoveFolder(folderId: string, destinationId: string): Promise<void> {
  try {
    await moveFolderToDestination(folderId, destinationId);
  } catch (err) {
    const error = AppError.parseError(err);
    if (error.code === 'FOLDER_NOT_FOUND') {
      showToast('Folder not found', 'error');
    } else {
      showToast(error.message, 'error');
    }
  }
}



// narrowed-via-parse-wrap-utility: catch(err) wrapped via AppError.parseError; all accesses on typed result
declare const AppError: { parseError(e: unknown): { code: string; message: string } };
declare function useTemplateCopy(templateId: string, recipientCount: number): Promise<{ id: string }>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleUseTemplate(templateId: string, recipientCount: number): Promise<string | null> {
  try {
    const result = await useTemplateCopy(templateId, recipientCount);
    return result.id;
  } catch (err) {
    const error = AppError.parseError(err);
    showToast(error.message, 'error');
    return null;
  }
}



// catch-variable-never-accessed: catch(err) never accessed; block shows fixed toast without touching err
declare function resendDocumentToRecipient(documentId: string, recipientId: string): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleResendDocument(documentId: string, recipientId: string): Promise<void> {
  try {
    await resendDocumentToRecipient(documentId, recipientId);
    showToast('Document sent successfully', 'success');
  } catch (err) {
    showToast('Failed to resend document. Please try again.', 'error');
  }
}
