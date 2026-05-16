
// Wave-M12: Promise.all([renderEmail(...), renderEmail(...)]) with correctly typed args
declare function renderEmailTemplate(template: object, opts: { lang: string; plainText?: boolean }): Promise<string>;
declare const emailTemplate: object;
declare const emailLang: string;

async function sendNotificationEmail() {
  const [html, text] = await Promise.all([
    renderEmailTemplate(emailTemplate, { lang: emailLang }),
    renderEmailTemplate(emailTemplate, { lang: emailLang, plainText: true }),
  ]);
  return { html, text };
}



// Wave-M19: Promise.all(collection.items.map(async (item) => {...})) — standard async map
declare const order: { lineItems: Array<{ id: string; documentData: { content: string } }> };
declare function fetchFile(data: object): Promise<Buffer>;

async function buildEmailAttachments() {
  const attachments = await Promise.all(
    order.lineItems.map(async (lineItem) => {
      const file = await fetchFile(lineItem.documentData);
      return {
        filename: `${lineItem.id}.pdf`,
        content: Buffer.from(file),
        contentType: 'application/pdf',
      };
    }),
  );
  return attachments;
}



// Shape: Buffer.from(file) used as email attachment content — no type mismatch
declare function getFileBytes(fileRef: string): Promise<Uint8Array>;
declare function sendEmailWithAttachments(opts: {
  to: string;
  subject: string;
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<void>;

export async function emailCompletedReport(to: string, fileRef: string, filename: string) {
  const file = await getFileBytes(fileRef);

  await sendEmailWithAttachments({
    to,
    subject: 'Your report is ready',
    attachments: [
      {
        filename: filename.endsWith('.pdf') ? filename : filename + '.pdf',
        content: Buffer.from(file),
        contentType: 'application/pdf',
      },
    ],
  });
}
