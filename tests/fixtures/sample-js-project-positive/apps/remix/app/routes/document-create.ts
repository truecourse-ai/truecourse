
// Pass-through with label: console.error('Error creating document:', err) — no property access on err
async function createNewDocument(templateId: string, title: string): Promise<{ id: string }> {
  try {
    return await initializeDocument({ templateId, title });
  } catch (err) {
    console.error('Error creating document:', err);
    throw err;
  }
}

interface DocumentInit { templateId: string; title: string; }
declare function initializeDocument(init: DocumentInit): Promise<{ id: string }>;
