
// Promise.all with async map over recipients array
declare interface Recipient { id: string; email: string; name: string; token: string; }
declare function sendNotificationEmail(recipient: Recipient, templateData: Record<string, string>): Promise<void>;
declare function buildEmailTemplate(data: Record<string, string>): Record<string, string>;

async function notifyAllRecipients(recipients: Recipient[], docName: string): Promise<void> {
  const templateData = buildEmailTemplate({ documentName: docName });
  await Promise.all(
    recipients.map(async (recipient) => {
      await sendNotificationEmail(recipient, templateData);
    }),
  );
}



// Promise.all with async map over items to process
declare interface QueueItem { id: string; payload: Record<string, unknown>; }
declare function processQueueItem(item: QueueItem): Promise<{ success: boolean; id: string }>;

async function processBatch(items: QueueItem[]): Promise<Array<{ success: boolean; id: string }>> {
  return Promise.all(
    items.map(async (item) => {
      return processQueueItem(item);
    }),
  );
}



// Promise.allSettled with async map
declare interface ScheduledJob { id: string; envelopeId: string; }
declare function triggerJobProcessing(jobId: string): Promise<void>;

async function processAllScheduledJobs(jobs: ScheduledJob[]): Promise<void> {
  await Promise.allSettled(
    jobs.map(async (job) => {
      await triggerJobProcessing(job.id);
    }),
  );
}



// Promise.all([renderEmail(...), renderEmail(..., { plainText: true })])
declare interface EmailTemplate { subject: string; body: string; }
declare interface RenderOptions { lang: string; branding: Record<string, unknown>; plainText?: boolean; }
declare function renderEmailWithLocale(template: EmailTemplate, opts: RenderOptions): Promise<string>;
declare const notificationTemplate: EmailTemplate;
declare const userLang: string;
declare const orgBranding: Record<string, unknown>;

async function renderEmailVariants(template: EmailTemplate, lang: string, branding: Record<string, unknown>): Promise<[string, string]> {
  const [html, text] = await Promise.all([
    renderEmailWithLocale(template, { lang, branding }),
    renderEmailWithLocale(template, { lang, branding, plainText: true }),
  ]);
  return [html, text];
}
