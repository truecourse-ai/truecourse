
// D13: async map creating email templates — no type mismatch
declare function createElement(component: unknown, props: Record<string, unknown>): unknown;
declare function sendEmail(opts: { to: string; template: unknown }): Promise<void>;

interface NotificationRecipient {
  id: string;
  email: string;
  name: string;
}

interface CancellationPayload {
  documentTitle: string;
  senderName: string;
}

declare const EmailCancelledTemplate: unknown;

export async function sendCancellationEmails(
  recipients: NotificationRecipient[],
  payload: CancellationPayload
): Promise<void> {
  await Promise.all(
    recipients.map(async (recipient) => {
      const template = createElement(EmailCancelledTemplate, {
        recipientName: recipient.name,
        documentTitle: payload.documentTitle,
        senderName: payload.senderName,
      });
      await sendEmail({ to: recipient.email, template });
    })
  );
}



// --- shape de60ae0309f7: Promise.all(recipients.map(async (r) => sendEmail(...))) ---
declare function sendReminderEmail(opts: {
  recipientEmail: string;
  recipientName: string;
  documentTitle: string;
}): Promise<void>;

declare const recipientsToRemind: Array<{ email: string; name: string; role: string }>;
declare const documentTitle: string;

await Promise.all(
  recipientsToRemind.map(async (recipient) => {
    if (recipient.role === 'CC') {
      return;
    }
    await sendReminderEmail({
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      documentTitle,
    });
  }),
);
