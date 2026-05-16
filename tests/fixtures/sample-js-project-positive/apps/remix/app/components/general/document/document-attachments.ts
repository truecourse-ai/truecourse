
// AppError.parseError normalization: immediately normalizes err at first catch statement
declare const TypedErrorParser: { parseError(e: unknown): { code: string; message: string } };
declare function showNotification(opts: { title: string; variant: string }): void;
declare function addAttachmentToDocument(docId: string, file: File): Promise<void>;

async function handleAddAttachment(docId: string, file: File): Promise<void> {
  try {
    await addAttachmentToDocument(docId, file);
  } catch (err) {
    const error = TypedErrorParser.parseError(err);
    console.error(error);
    showNotification({ title: 'Failed to add attachment', variant: 'destructive' });
  }
}
