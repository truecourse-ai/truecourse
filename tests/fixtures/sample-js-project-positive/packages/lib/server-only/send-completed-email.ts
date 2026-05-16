declare function renderCompletedEmailForOwner(docId: string): Promise<string>;
declare function renderCompletedEmailForRecipients(docId: string): Promise<string[]>;
declare function dispatchEmail(to: string, html: string): Promise<void>;

export async function sendCompletedEmails(docId: string, ownerEmail: string, recipientEmails: string[]) {
  const [ownerHtml, recipientHtmls] = await Promise.all([
    renderCompletedEmailForOwner(docId),
    renderCompletedEmailForRecipients(docId),
  ]);
  await Promise.all([
    dispatchEmail(ownerEmail, ownerHtml),
    ...recipientEmails.map((email, i) => dispatchEmail(email, recipientHtmls[i])),
  ]);
}



declare function renderCompletedSignerEmail(signerId: string, locale: string): Promise<string>;
declare function deliverEmail(to: string, html: string): Promise<void>;

export async function sendCompletedSignerEmails(
  signers: Array<{ id: string; email: string }>,
  locale: string,
) {
  const htmls = await Promise.all(
    signers.map((s) => renderCompletedSignerEmail(s.id, locale)),
  );
  await Promise.all(
    signers.map((s, i) => deliverEmail(s.email, htmls[i])),
  );
}
