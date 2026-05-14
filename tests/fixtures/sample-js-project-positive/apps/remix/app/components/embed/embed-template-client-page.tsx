
declare function createDocumentFromTemplate(opts: {
  templateToken: string;
  recipientName: string;
  recipientEmail: string;
}): Promise<{ documentId: string; token: string; recipientId: string }>;
declare const templateToken: string;
declare const recipientName: string;
declare const recipientEmail: string;

async function handleTemplateSubmit() {
  const {
    documentId,
    token: documentToken,
    recipientId,
  } = await createDocumentFromTemplate({
    templateToken,
    recipientName,
    recipientEmail,
  });

  return { documentId, documentToken, recipientId };
}
