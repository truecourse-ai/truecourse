
// FP shape 02d9d46d3985: destructured async map callback — no type mismatch
interface NotificationTask { originalTemplate: string; updatePayload: object; recipientEmail: string; }
declare function sendEmail(template: string, to: string, data: object): Promise<void>;
declare const pendingNotifications: NotificationTask[];

async function dispatchNotifications() {
  await Promise.all(
    pendingNotifications.map(async ({ originalTemplate, updatePayload, recipientEmail }) => {
      await sendEmail(originalTemplate, recipientEmail, updatePayload);
    })
  );
}



// FP shape 0445b847b573: Promise.all with parallel renders — no type mismatch
interface EmailTemplate { subject: string; body: string; }
interface RenderOptions { locale: string; branding: object; }
declare function renderEmail(template: EmailTemplate, opts: RenderOptions): Promise<string>;
declare const confirmationTemplate: EmailTemplate;
declare const defaultBranding: object;

async function renderBilingual(locale1: string, locale2: string) {
  const [html1, html2] = await Promise.all([
    renderEmail(confirmationTemplate, { locale: locale1, branding: defaultBranding }),
    renderEmail(confirmationTemplate, { locale: locale2, branding: defaultBranding }),
  ]);
  return { html1, html2 };
}



// FP shape 05d34ffc207b: task runner with async callback — no type mismatch
interface TaskRunner { runTask: (name: string, fn: () => Promise<unknown>) => Promise<unknown> }
declare function createElement<T>(component: T, props: object): unknown;
declare const RejectionEmailTemplate: unknown;
declare const io: TaskRunner;
declare const ownerId: string;
declare const documentTitle: string;

async function notifyOwnerOfRejection() {
  await io.runTask('send-owner-rejection-email', async () => {
    const emailElement = createElement(RejectionEmailTemplate, {
      recipientId: ownerId,
      documentName: documentTitle,
    });
    return emailElement;
  });
}



// FP shape 065fb6886523: Promise.all parallel renders with ORM context — no type mismatch
interface EmailBranding { primaryColor: string; logoUrl: string; }
interface CancellationTemplate { subject: string; recipientType: 'owner' | 'member' }
declare function renderEmailTemplate(template: CancellationTemplate, opts: { locale: string; branding: EmailBranding }): Promise<string>;
declare const cancellationTemplate: CancellationTemplate;
declare const branding: EmailBranding;

async function renderCancellationEmails(ownerLocale: string, memberLocale: string) {
  const [ownerHtml, memberHtml] = await Promise.all([
    renderEmailTemplate(cancellationTemplate, { locale: ownerLocale, branding }),
    renderEmailTemplate(cancellationTemplate, { locale: memberLocale, branding }),
  ]);
  return { ownerHtml, memberHtml };
}
