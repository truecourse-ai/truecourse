declare function insertDocumentRecord(templateId: string, ownerId: string, name: string): Promise<{ id: string }>;
declare function copyTemplateFields(templateId: string, docId: string): Promise<void>;
declare function copyTemplateRecipients(templateId: string, docId: string): Promise<void>;

export async function createDocumentFromTemplate(templateId: string, ownerId: string, name: string) {
  const document = await insertDocumentRecord(templateId, ownerId, name);
  await Promise.all([
    copyTemplateFields(templateId, document.id),
    copyTemplateRecipients(templateId, document.id),
  ]);
  return document;
}
