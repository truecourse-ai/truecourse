
// FP shape: async map for email template creation; no type mismatch
declare function createElement(component: unknown, props: unknown): Promise<unknown>;
declare const CancelledEmail: unknown;
declare const notifyList: Array<{ email: string; name: string }>;

async function buildEmailTemplates() {
  const templates = await Promise.all(
    notifyList.map(async (recipient) =>
      createElement(CancelledEmail, { recipientName: recipient.name, recipientEmail: recipient.email })
    )
  );
  return templates;
}



// FP shape: Promise.all with async map sending emails; no type mismatch
declare function sendEmail(to: string, subject: string, body: string): Promise<void>;
declare const completedList: Array<{ email: string; documentTitle: string }>;

async function notifyCompletion() {
  await Promise.all(
    completedList.map(async (recipient) =>
      sendEmail(recipient.email, `Document signed: ${recipient.documentTitle}`, 'Your document has been signed.')
    )
  );
}



// --- FP shape: comment-only catch block documenting intentional suppression ---
declare function revokeTeamEmailVerification(teamId: string): Promise<void>;
declare function sendTeamEmailRevokedNotification(teamId: string, email: string): Promise<void>;

async function removeTeamEmail(teamId: string, email: string): Promise<void> {
  await revokeTeamEmailVerification(teamId);
  try {
    await sendTeamEmailRevokedNotification(teamId, email);
  } catch {
    // Notification email failure must not block team email revocation.
    // The primary operation has already completed — email is a best-effort side effect.
  }
}



// --- inconsistent-return shape: callback-style nodemailer transport (idiomatic early-exit) ---
// `return callback(...)` is idiomatic early-exit guard in a void-returning
// method; no caller reads the return value. Mixed return is intentional.
declare type MailData = { to?: string; from?: string; subject?: string; html?: string };
declare type MailMessage = { data: MailData };
declare type SentInfo = { messageId: string };
declare type SendCallback = (err: Error | null, info: SentInfo | null) => void;

class SmtpRelayTransport {
  public send(mail: MailMessage, callback: SendCallback): void {
    if (!mail.data.to || !mail.data.from) {
      return callback(new Error('Missing required fields "to" or "from"'), null);
    }

    if (!mail.data.subject) {
      return callback(new Error('Missing required field "subject"'), null);
    }

    fetch('https://relay.example.com/send', {
      method: 'POST',
      body: JSON.stringify(mail.data),
      headers: { 'Content-Type': 'application/json' },
    })
      .then(() => callback(null, { messageId: 'sent' }))
      .catch((err: Error) => callback(err, null));
  }
}



// --- invalid-void-type shape: void as callback return type in method signature ---
// `(_err: Error | null, _info: SentInfo | null) => void` is a valid TypeScript
// callback type. The rule incorrectly flags this idiomatic callback signature.
declare type DeliveryInfo = { messageId: string; accepted: string[] };

interface EmailTransport {
  deliver(
    message: { to: string; from: string; subject: string; html: string },
    done: (_err: Error | null, _info: DeliveryInfo | null) => void,
  ): void;
}

declare const smtpTransport: EmailTransport;



declare function msg(strings: TemplateStringsArray, ...values: unknown[]): string;

function buildNotificationSubject(documentTitle: string, recipientName: string) {
  // Inner template adds literal quote chars inside a tagged template (i18n macro)
  return msg`${recipientName} has been invited to sign "${documentTitle}"`;
}

function buildReminderSubject(documentTitle: string) {
  return msg`Reminder: please sign "${`"${documentTitle}"`}"`;
}
