declare const db: {
  $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
};
declare function insertDocumentFromTemplate(tx: unknown, templateId: string, name: string): Promise<{ id: string }>;
declare function insertDocumentRecipient(tx: unknown, docId: string, recipientId: string): Promise<void>;

export async function createDocumentFromDirectTemplate(templateId: string, name: string, recipientIds: string[]) {
  return db.$transaction(async (tx) => {
    const document = await insertDocumentFromTemplate(tx, templateId, name);
    await Promise.all(
      recipientIds.map((rId) => insertDocumentRecipient(tx, document.id, rId)),
    );
    return document;
  });
}



declare function copyDirectTemplateFields(templateId: string, docId: string): Promise<void>;
declare function copyDirectTemplateSigners(templateId: string, docId: string): Promise<void>;
declare function sendDirectTemplateInvitations(docId: string): Promise<void>;

export async function finaliseDirectTemplateDocument(templateId: string, docId: string) {
  await Promise.all([
    copyDirectTemplateFields(templateId, docId),
    copyDirectTemplateSigners(templateId, docId),
    sendDirectTemplateInvitations(docId),
  ]);
}
