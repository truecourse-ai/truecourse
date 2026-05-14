export function renderEmail(subject: string, body: string): string {
  return `<h1>${subject}</h1><div>${body}</div>`;
}
export function renderWelcome(userName: string): string {
  return `<p>Hello ${userName}</p>`;
}
export function renderAlert(level: string, message: string): string {
  return `<strong>${level}</strong>: ${message}`;
}



// FP shape: Promise.all([renderWithLocale(tmpl, opts1), renderWithLocale(tmpl, opts2)]) — parallel render calls
declare function renderWithLocale(template: string, opts: { locale: string; recipientName: string }): Promise<string>;
declare const CANCELLATION_TEMPLATE: string;
declare const ownerName: string;
declare const counterpartyName: string;

async function renderCancellationEmails() {
  const [ownerEmail, counterpartyEmail] = await Promise.all([
    renderWithLocale(CANCELLATION_TEMPLATE, { locale: 'en', recipientName: ownerName }),
    renderWithLocale(CANCELLATION_TEMPLATE, { locale: 'en', recipientName: counterpartyName }),
  ]);
  return { ownerEmail, counterpartyEmail };
}



// Promise.all with two renderEmail calls (html + plain text) - standard pattern (argument-type-mismatch FP)
declare function renderEmailWithI18n(
  template: any,
  options?: { plainText?: boolean }
): Promise<string>;

async function prepareEmailContent(template: any): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([
    renderEmailWithI18n(template),
    renderEmailWithI18n(template, { plainText: true }),
  ]);
  return { html, text };
}



// FP shape: regex flag and replacement string in a single email template normalizer (single-usage-false-trigger)
function normalizeEmailBodyText(text: string): string {
  if (!text || !text.trim()) {
    return '';
  }

  const normalized = text
    .trim()
    .replace(/
?/g, '
')
    .replace(/
\s*
+/g, '

')
    .replace(/
{2,}/g, '

');

  return normalized;
}



declare const DEFAULT_DIGEST_WINDOW_MS: number;
declare const DEFAULT_ALERT_TTL_MS: number;

type BaseTemplateConfig = {
  channel: 'email' | 'sms' | 'push' | 'webhook' | 'slack' | 'in_app';
  retryCount: number;
};

type WelcomeTemplateConfig = BaseTemplateConfig & {
  kind: 'welcome';
  greeting: string;
  ctaLabel: string;
};

type PasswordResetTemplateConfig = BaseTemplateConfig & {
  kind: 'password_reset';
  tokenTtlMs: number;
  greeting: string;
};

type InvoiceTemplateConfig = BaseTemplateConfig & {
  kind: 'invoice';
  currency: string;
  lineItemLimit: number;
  greeting: string;
};

type DigestTemplateConfig = BaseTemplateConfig & {
  kind: 'digest';
  windowMs: number;
  maxItems: number;
};

type AlertTemplateConfig = BaseTemplateConfig & {
  kind: 'alert';
  severity: 'info' | 'warn' | 'error';
  ttlMs: number;
  escalate: boolean;
};

type MentionTemplateConfig = BaseTemplateConfig & {
  kind: 'mention';
  actorLabel: string;
  preview: string;
  highlight: boolean;
};

type CommentTemplateConfig = BaseTemplateConfig & {
  kind: 'comment';
  threadDepth: number;
  collapseAfter: number;
  preview: string;
};

type FollowTemplateConfig = BaseTemplateConfig & {
  kind: 'follow';
  showFollowBack: boolean;
  actorLabel: string;
};

type ReceiptTemplateConfig = BaseTemplateConfig & {
  kind: 'receipt';
  currency: string;
  taxRegion: string;
  greeting: string;
};

export type TemplateConfig =
  | WelcomeTemplateConfig
  | PasswordResetTemplateConfig
  | InvoiceTemplateConfig
  | DigestTemplateConfig
  | AlertTemplateConfig
  | MentionTemplateConfig
  | CommentTemplateConfig
  | FollowTemplateConfig
  | ReceiptTemplateConfig;

export enum TemplateKind {
  WELCOME = 'welcome',
  PASSWORD_RESET = 'password_reset',
  INVOICE = 'invoice',
  DIGEST = 'digest',
  ALERT = 'alert',
  MENTION = 'mention',
  COMMENT = 'comment',
  FOLLOW = 'follow',
  RECEIPT = 'receipt',
}

export const getDefaultTemplateConfig = (kind: TemplateKind): TemplateConfig => {
  switch (kind) {
    case TemplateKind.WELCOME:
      return {
        kind: 'welcome',
        channel: 'email',
        retryCount: 2,
        greeting: 'Hello',
        ctaLabel: 'Get started',
      };
    case TemplateKind.PASSWORD_RESET:
      return {
        kind: 'password_reset',
        channel: 'email',
        retryCount: 3,
        greeting: 'Hi',
        tokenTtlMs: 15 * 60 * 1000,
      };
    case TemplateKind.INVOICE:
      return {
        kind: 'invoice',
        channel: 'email',
        retryCount: 3,
        currency: 'USD',
        lineItemLimit: 50,
        greeting: 'Hi',
      };
    case TemplateKind.DIGEST:
      return {
        kind: 'digest',
        channel: 'email',
        retryCount: 1,
        windowMs: DEFAULT_DIGEST_WINDOW_MS,
        maxItems: 20,
      };
    case TemplateKind.ALERT:
      return {
        kind: 'alert',
        channel: 'push',
        retryCount: 4,
        severity: 'warn',
        ttlMs: DEFAULT_ALERT_TTL_MS,
        escalate: false,
      };
    case TemplateKind.MENTION:
      return {
        kind: 'mention',
        channel: 'in_app',
        retryCount: 1,
        actorLabel: '',
        preview: '',
        highlight: true,
      };
    case TemplateKind.COMMENT:
      return {
        kind: 'comment',
        channel: 'in_app',
        retryCount: 1,
        threadDepth: 0,
        collapseAfter: 3,
        preview: '',
      };
    case TemplateKind.FOLLOW:
      return {
        kind: 'follow',
        channel: 'in_app',
        retryCount: 1,
        showFollowBack: true,
        actorLabel: '',
      };
    case TemplateKind.RECEIPT:
      return {
        kind: 'receipt',
        channel: 'email',
        retryCount: 2,
        currency: 'USD',
        taxRegion: 'US',
        greeting: 'Thanks',
      };
    default:
      throw new Error(`Unsupported template kind: ${kind as string}`);
  }
};
