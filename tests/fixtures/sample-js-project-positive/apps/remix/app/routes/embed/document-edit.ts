
// FP shape: function call with object literal argument (not a complex expression)
declare function updateEmbeddingDocument(opts: {
  documentId: string;
  title: string;
  externalId?: string;
  meta: { timezone?: string; language?: string; signingOrder?: string };
  recipients: Array<{ id?: string; email: string; name: string; role: string }>;
}): Promise<{ id: string }>;

declare const configuration: { title: string; meta: { externalId?: string; timezone?: string; language?: string; signingOrder?: string }; signers: Array<{ nativeId?: string; email: string; name: string; role: string }> };
declare const document: { id: string };
declare const externalId: string | undefined;

const handleDocumentUpdate = async () => {
  const result = await updateEmbeddingDocument({
    documentId: document.id,
    title: configuration.title,
    externalId: externalId ?? configuration.meta.externalId,
    meta: {
      timezone: configuration.meta.timezone,
      language: configuration.meta.language,
      signingOrder: configuration.meta.signingOrder,
    },
    recipients: configuration.signers.map((s) => ({
      id: s.nativeId,
      email: s.email,
      name: s.name,
      role: s.role,
    })),
  });
  return result;
};



// safe-value-pass-no-property-access: catch(err) only console.error('label:', err) and fixed toast; no unsafe property access
declare function updateEmbedDocument(documentId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(msg: string, type: 'error' | 'success'): void;

async function handleEmbedDocumentUpdate(documentId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateEmbedDocument(documentId, data);
    showToast('Document updated', 'success');
  } catch (err) {
    console.error('Error updating document:', err);
    showToast('Failed to update document. Please try again.', 'error');
  }
}
