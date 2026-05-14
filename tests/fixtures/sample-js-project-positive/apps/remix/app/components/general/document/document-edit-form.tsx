declare const utils: { document: { get: { setData: (key: any, updater: (old: any) => any) => void } } };
declare const initialDocument: { id: string };
declare function useMutation(opts: any): { mutateAsync: (...args: any[]) => Promise<any> };

const { mutateAsync: updateDocument } = useMutation({
  onSuccess: (newData: any) => {
    utils.document.get.setData(
      { documentId: initialDocument.id },
      (oldData: any) => ({ ...(oldData || initialDocument), ...newData }),
    );
  },
});

const { mutateAsync: addFields } = useMutation({
  onSuccess: ({ fields: newFields }: any) => {
    utils.document.get.setData(
      { documentId: initialDocument.id },
      (oldData: any) => ({ ...(oldData || initialDocument), fields: newFields }),
    );
  },
});



// [unknown-catch-variable] catch(err) — only console.error(err) then fixed toast; no property access
declare function saveDocumentDraft(opts: { title: string; content: string; documentId: string }): Promise<void>;
declare const documentId: string;
declare const editToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleSaveDraft(title: string, content: string): Promise<void> {
  try {
    await saveDocumentDraft({ title, content, documentId });
    editToast({ title: 'Draft saved', description: 'Your changes have been saved.' });
  } catch (err) {
    console.error(err);
    editToast({
      title: 'Save failed',
      description: 'Unable to save your changes. Please try again.',
      variant: 'destructive',
    });
  }
}



// [unknown-catch-variable] catch(err) — console.error(err) + fixed toast; no property access (second handler)
declare function publishDocument(opts: { documentId: string; notifyRecipients: boolean }): Promise<void>;
declare const documentId: string;
declare const publishToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleDocumentPublish(notifyRecipients: boolean): Promise<void> {
  try {
    await publishDocument({ documentId, notifyRecipients });
    publishToast({ title: 'Document sent', description: 'The document has been sent to all recipients.' });
  } catch (err) {
    console.error(err);
    publishToast({
      title: 'Send failed',
      description: 'We could not send the document. Please try again.',
      variant: 'destructive',
    });
  }
}
