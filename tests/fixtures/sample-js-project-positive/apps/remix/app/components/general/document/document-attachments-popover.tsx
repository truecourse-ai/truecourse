declare const utils: { document: { attachment: { find: { invalidate: (opts: { documentId: string }) => Promise<void> } } } };
declare const documentId: string;
declare function useMutation(opts: any): { mutateAsync: (...args: any[]) => Promise<any>; isPending: boolean };

const { mutateAsync: addAttachment, isPending: isAdding } = useMutation({
  onSuccess: () => {
    void utils.document.attachment.find.invalidate({ documentId });
  },
});

const { mutateAsync: removeAttachment } = useMutation({
  onSuccess: () => {
    void utils.document.attachment.find.invalidate({ documentId });
  },
});



// [unknown-catch-variable] catch(err) — AppError.parseError; only typed error.message accessed
declare const AppError: { parseError(err: unknown): { code: string; message: string } };
declare function deleteDocumentAttachment(opts: { documentId: string; attachmentId: string }): Promise<void>;
declare const attachmentToast: (opts: { title: string; description: string; variant?: string }) => void;
declare const documentId: string;

async function handleAttachmentDelete(attachmentId: string): Promise<void> {
  try {
    await deleteDocumentAttachment({ documentId, attachmentId });
    attachmentToast({ title: 'Attachment removed', description: 'The attachment has been deleted.' });
  } catch (err) {
    const error = AppError.parseError(err);
    attachmentToast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
  }
}
