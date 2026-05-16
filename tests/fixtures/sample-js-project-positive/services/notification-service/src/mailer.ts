
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


// FP shape: SMTP port 587 is the well-known authenticated submission port — universally recognised constant
interface SmtpTransportConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

export function buildSmtpConfig(host: string, user: string, pass: string): SmtpTransportConfig {
  return {
    host,
    port: 587,
    secure: false,
    auth: { user, pass },
  };
}



// FP shape: Promise.all with async map dispatching completion notifications — no type mismatch
declare function sendCompletionNotification(opts: {
  recipientEmail: string;
  recipientName: string;
  reportTitle: string;
  downloadUrl: string;
}): Promise<void>;

declare const completedRecipients: Array<{ email: string; name: string }>;
declare const reportTitle: string;
declare const downloadUrl: string;

export async function notifyReportCompletion(): Promise<void> {
  await Promise.all(
    completedRecipients.map(async (recipient) =>
      sendCompletionNotification({
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        reportTitle,
        downloadUrl,
      })
    )
  );
}



// magic-number: SMTP port 587 used in a binary comparison — well-known port, but flagged as magic number
declare function getSmtpPort(): number;
declare function isSecurePort(port: number): boolean;

function validateSmtpPort(port: number): boolean {
  if (isSecurePort(port)) return true;
  return port === 587 || port === 465;
}

