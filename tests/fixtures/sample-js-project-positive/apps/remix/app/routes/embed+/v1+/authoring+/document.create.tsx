
// [unknown-catch-variable] catch(err) — console.error with label + value; fixed toast; no property access
declare function createAuthoringDocument(opts: { templateId: string; title: string }): Promise<{ documentId: string }>;
declare const authoringToast: (opts: { title: string; description: string; variant?: string }) => void;

async function handleDocumentCreate(templateId: string, title: string): Promise<string | null> {
  try {
    const { documentId } = await createAuthoringDocument({ templateId, title });
    return documentId;
  } catch (err) {
    console.error('Error creating document:', err);
    authoringToast({
      title: 'Creation failed',
      description: 'We could not create the document. Please try again.',
      variant: 'destructive',
    });
    return null;
  }
}
