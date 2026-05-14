const SEND_TIMEOUT_MS = 30 * 1000;
export function getSendTimeout(): number { return SEND_TIMEOUT_MS; }
export function validateEmailAddress(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
  return emailRegex.test(email);
}
export function formatRecipient(email: string, name: string): string {
  return `${name} <${email}>`;
}



// --- raw-error-in-response shape: non-http-context (error stored in DB record, not HTTP response) ---
declare function persistWebhookCallResult(result: { webhookId: string; status: 'success' | 'failed'; errorMessage?: string; responseCode?: number }): Promise<void>;

async function executeWebhookDelivery(
  webhookId: string,
  url: string,
  payload: unknown
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await persistWebhookCallResult({
      webhookId,
      status: response.ok ? 'success' : 'failed',
      responseCode: response.status,
    });
  } catch (err) {
    // err.message stored in DB webhook-call log for diagnostics
    // NOT returned in any HTTP API response to a client
    await persistWebhookCallResult({
      webhookId,
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}



// FP: Promise.all(recipientsToNotify.map(async (recipient) => {...})) — standard async map pattern
interface NotificationRecipient { id: string; email: string; name: string; locale: string; }
declare function sendNotificationEmail(recipient: NotificationRecipient): Promise<void>;
declare const recipientsToNotify: NotificationRecipient[];

async function notifyAllRecipients() {
  await Promise.all(
    recipientsToNotify.map(async (recipient) => {
      await sendNotificationEmail(recipient);
    }),
  );
}



// Declare external webhook dispatcher
declare function dispatchWebhook(config: {
  event: string;
  payload: Record<string, unknown>;
  targetUrl: string;
  retries?: number;
}): Promise<void>;

export async function notifySubscribers(
  userId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  // Send webhooks to multiple subscribers without blocking on failures
  await Promise.allSettled([
    dispatchWebhook({
      event: eventType,
      payload: { userId, ...data },
      targetUrl: 'https://webhook1.example.com/events',
      retries: 3,
    }),
    dispatchWebhook({
      event: eventType,
      payload: { userId, ...data },
      targetUrl: 'https://webhook2.example.com/events',
      retries: 3,
    }),
  ]);
}



declare function renderNotificationEmail(
  content: unknown,
  opts: { lang: string; branding?: Record<string, string>; plainText?: boolean }
): Promise<string>;

async function dispatchMemberRemovedEmail(
  content: unknown,
  lang: string,
  branding: Record<string, string>,
): Promise<void> {
  const [html, text] = await Promise.all([
    renderNotificationEmail(content, {
      lang,
      branding,
    }),
    renderNotificationEmail(content, {
      lang,
      branding,
      plainText: true,
    }),
  ]);
  void html;
  void text;
}



declare function renderLocalizedEmail(
  template: { kind: string; props: Record<string, unknown> },
  options: { locale: string; brand: string; plainText?: boolean },
): Promise<string>;

declare const mailerClient: {
  deliver(message: {
    to: { name: string; address: string };
    from: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
};

interface OwnerExpiryNotification {
  recipientName: string;
  recipientEmail: string;
  documentTitle: string;
  documentUrl: string;
  ownerName: string;
  ownerEmail: string;
  senderAddress: string;
  locale: string;
  brand: string;
}

export async function dispatchOwnerExpiryEmail(ctx: OwnerExpiryNotification): Promise<void> {
  const template = {
    kind: 'RecipientExpiredNotice',
    props: {
      recipientName: ctx.recipientName,
      recipientEmail: ctx.recipientEmail,
      documentTitle: ctx.documentTitle,
      documentUrl: ctx.documentUrl,
    },
  };

  const [html, text] = await Promise.all([
    renderLocalizedEmail(template, { locale: ctx.locale, brand: ctx.brand }),
    renderLocalizedEmail(template, {
      locale: ctx.locale,
      brand: ctx.brand,
      plainText: true,
    }),
  ]);

  await mailerClient.deliver({
    to: { name: ctx.ownerName, address: ctx.ownerEmail },
    from: ctx.senderAddress,
    subject: `Signing window expired for "${ctx.recipientName}" on "${ctx.documentTitle}"`,
    html,
    text,
  });
}



// SMTP port 587 is the well-known submission port for authenticated SMTP
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
}

export function getDefaultSmtpConfig(host: string): SmtpConfig {
  return { host, port: 587, secure: false };
}



declare const mailer: { sendMail(opts: { to: { name: string; address: string }; from: { name: string; address: string }; replyTo: { name: string; address: string }; subject: string; html: string; text: string }): Promise<void> };
declare const db: { recipient: { updateMany(args: any): Promise<{ count: number }>; findFirst(args: any): Promise<any> }; auditLog: { create(args: any): Promise<void> } };
declare function getI18nInstance(lang: string): Promise<{ _(msg: any): string }>;
declare function getEmailContext(opts: { emailType: string; source: { type: string; teamId: string | null }; meta: any }): Promise<{ branding: any; emailLanguage: string; orgType: string; senderEmail: { name: string; address: string }; replyToEmail: { name: string; address: string } }>;
declare function renderTemplate(template: any, vars: Record<string, string>): string;
declare function renderHtml(template: any, opts: { lang: string; branding: any }): Promise<string>;
declare function renderText(template: any, opts: { lang: string; branding: any; plainText: boolean }): Promise<string>;
declare function buildReminderTemplate(opts: { recipientName: string; documentName: string; baseUrl: string; signingLink: string; customBody: string | undefined; role: string }): any;
declare function triggerWebhookEvent(opts: { event: string; data: any; userId: string; teamId: string | null }): Promise<void>;
declare function updateNextReminderSchedule(opts: { recipientId: string; envelopeId: string; sentAt: Date; lastReminderSentAt: Date }): Promise<void>;
declare const ZReminderWebhookPayloadSchema: { parse(data: any): any };
declare function mapEnvelopeToWebhookPayload(envelope: any): any;
declare const APP_BASE_URL: () => string;
declare const ROLE_ACTION_VERBS: Record<string, { actionVerb: string }>;
declare const EMAIL_TYPE: { REMINDER: string };
declare const AUDIT_LOG_TYPE: { EMAIL_SENT: string };
declare const DISTRIBUTION_METHOD: { NONE: string };
declare const ORG_TYPE: { ORGANISATION: string };
declare const SIGNING_STATUS: { NOT_SIGNED: string };
declare const SEND_STATUS: { SENT: string };
declare const RECIPIENT_ROLE: { CC: string };
declare const ENVELOPE_STATUS: { PENDING: string };
declare const WEBHOOK_EVENT: { REMINDER_SENT: string };
declare function extractEmailSettings(meta: any): { recipientSigningRequest: boolean };
declare function buildAuditLogEntry(opts: { type: string; envelopeId: string; data: any }): any;
declare const msg: (strings: TemplateStringsArray, ...values: any[]) => any;

export const runReminderJob = async ({ payload, io }: { payload: { recipientId: string }; io: { logger: { info(msg: string): void; warn(msg: string): void } } }) => {
  const { recipientId } = payload;
  const now = new Date();

  const updatedCount = await db.recipient.updateMany({
    where: {
      id: recipientId,
      signingStatus: SIGNING_STATUS.NOT_SIGNED,
      sendStatus: SEND_STATUS.SENT,
      role: { not: RECIPIENT_ROLE.CC },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      envelope: {
        status: ENVELOPE_STATUS.PENDING,
        deletedAt: null,
      },
    },
    data: {
      lastReminderSentAt: now,
      nextReminderAt: null,
    },
  });

  if (updatedCount.count === 0) {
    io.logger.info(`Recipient ${recipientId} no longer eligible for reminder, skipping`);
    return;
  }

  const recipient = await db.recipient.findFirst({
    where: { id: recipientId },
    include: {
      envelope: {
        include: {
          documentMeta: true,
          user: true,
          recipients: true,
          team: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!recipient) {
    io.logger.warn(`Recipient ${recipientId} not found`);
    return;
  }

  const { envelope } = recipient;

  if (!envelope.documentMeta) {
    io.logger.warn(`Envelope ${envelope.id} missing documentMeta`);
    return;
  }

  if (envelope.documentMeta.distributionMethod === DISTRIBUTION_METHOD.NONE) {
    io.logger.info(`Envelope ${envelope.id} uses manual distribution, skipping email reminder`);
    return;
  }

  if (!extractEmailSettings(envelope.documentMeta).recipientSigningRequest) {
    io.logger.info(`Envelope ${envelope.id} has email signing requests disabled, skipping`);
    return;
  }

  const { branding, emailLanguage, orgType, senderEmail, replyToEmail } = await getEmailContext({
    emailType: 'RECIPIENT',
    source: {
      type: 'team',
      teamId: envelope.teamId,
    },
    meta: envelope.documentMeta,
  });

  const i18n = await getI18nInstance(emailLanguage);

  const recipientActionVerb = i18n._(ROLE_ACTION_VERBS[recipient.role].actionVerb).toLowerCase();

  let emailSubject = i18n._(msg`Reminder: Please ${recipientActionVerb} the document "${envelope.title}"`);

  if (orgType === ORG_TYPE.ORGANISATION) {
    emailSubject = i18n._(msg`Reminder: ${envelope.team.name} invited you to ${recipientActionVerb} a document`);
  }

  const customEmailVars = {
    'signer.name': recipient.name,
    'signer.email': recipient.email,
    'document.name': envelope.title,
  };

  if (envelope.documentMeta.subject) {
    emailSubject = renderTemplate(
      i18n._(msg`Reminder: ${envelope.documentMeta.subject}`),
      customEmailVars,
    );
  }

  const emailMessage = envelope.documentMeta.message
    ? renderTemplate(envelope.documentMeta.message, customEmailVars)
    : undefined;

  const baseUrl = APP_BASE_URL() || 'http://localhost:3000';
  const signingLink = `${APP_BASE_URL()}/sign/${recipient.token}`;

  io.logger.info(
    `Sending signing reminder for envelope ${envelope.id} to recipient ${recipient.id} (${recipient.email})`,
  );

  const template = buildReminderTemplate({
    recipientName: recipient.name,
    documentName: envelope.title,
    baseUrl,
    signingLink,
    customBody: emailMessage,
    role: recipient.role,
  });

  const [html, text] = await Promise.all([
    renderHtml(template, { lang: emailLanguage, branding }),
    renderText(template, {
      lang: emailLanguage,
      branding,
      plainText: true,
    }),
  ]);

  await mailer.sendMail({
    to: {
      name: recipient.name,
      address: recipient.email,
    },
    from: senderEmail,
    replyTo: replyToEmail,
    subject: emailSubject,
    html,
    text,
  });

  await db.auditLog.create({
    data: buildAuditLogEntry({
      type: AUDIT_LOG_TYPE.EMAIL_SENT,
      envelopeId: envelope.id,
      data: {
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        recipientId: recipient.id,
        recipientRole: recipient.role,
        emailType: EMAIL_TYPE.REMINDER,
        isResending: false,
      },
    }),
  });

  await triggerWebhookEvent({
    event: WEBHOOK_EVENT.REMINDER_SENT,
    data: ZReminderWebhookPayloadSchema.parse(mapEnvelopeToWebhookPayload(envelope)),
    userId: envelope.userId,
    teamId: envelope.teamId,
  });

  if (recipient.sentAt) {
    await updateNextReminderSchedule({
      recipientId: recipient.id,
      envelopeId: envelope.id,
      sentAt: recipient.sentAt,
      lastReminderSentAt: now,
    });
  }
};



declare const notificationStore: {
  findFirst: (args: unknown) => Promise<{
    id: string;
    recipientId: string;
    workspaceId: string;
    title: string;
    metadata: unknown;
    recipient: { id: string; email: string; name: string };
  } | null>;
};
declare function buildDispatchContext(args: unknown): Promise<{
  branding: { color: string; logoUrl: string };
  preferredLocale: string;
  fromAddress: string;
}>;
declare function extractDispatchSettings(meta: unknown): { archivedNotice: boolean };
declare function renderLocalizedTemplate(template: unknown, opts: unknown): Promise<string>;
declare function loadLocale(lang: string): Promise<{ _: (m: unknown) => string }>;
declare const NotificationArchivedTemplate: unknown;
declare function buildTemplateElement(template: unknown, props: unknown): unknown;
declare const PUBLIC_APP_URL: () => string | undefined;
declare const transportLayer: { dispatch: (args: unknown) => Promise<void> };
declare const t: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
class DispatchError extends Error {
  constructor(public code: string, public details: { message: string }) { super(details.message); }
}
const DISPATCH_ERROR_CODES = { NOT_FOUND: 'NOT_FOUND' };

export interface SendArchivedNotificationOptions {
  notificationId: string;
  rationale: string;
}

export const sendArchivedNotification = async ({ notificationId, rationale }: SendArchivedNotificationOptions) => {
  const record = await notificationStore.findFirst({
    where: {
      id: notificationId,
    },
    include: {
      recipient: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      metadata: true,
    },
  });

  if (!record) {
    throw new DispatchError(DISPATCH_ERROR_CODES.NOT_FOUND, {
      message: 'Notification record not found',
    });
  }

  const archivedNoticeEnabled = extractDispatchSettings(record.metadata).archivedNotice;

  if (!archivedNoticeEnabled) {
    return;
  }

  const { branding, preferredLocale, fromAddress } = await buildDispatchContext({
    audience: 'INTERNAL',
    origin: {
      kind: 'workspace',
      workspaceId: record.workspaceId,
    },
    metadata: record.metadata,
  });

  const { email, name } = record.recipient;

  const assetRootUrl = PUBLIC_APP_URL() || 'http://localhost:3000';

  const templateElement = buildTemplateElement(NotificationArchivedTemplate, {
    notificationTitle: record.title,
    rationale,
    assetRootUrl,
  });

  const [htmlBody, plainBody] = await Promise.all([
    renderLocalizedTemplate(templateElement, { lang: preferredLocale, branding }),
    renderLocalizedTemplate(templateElement, {
      lang: preferredLocale,
      branding,
      plainText: true,
    }),
  ]);

  const locale = await loadLocale(preferredLocale);

  await transportLayer.dispatch({
    to: {
      address: email,
      name: name || '',
    },
    from: fromAddress,
    subject: locale._(t`Notification Archived!`),
    html: htmlBody,
    text: plainBody,
  });
};
