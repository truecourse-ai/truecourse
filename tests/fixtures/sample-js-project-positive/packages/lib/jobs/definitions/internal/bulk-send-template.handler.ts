
// [unknown-catch-variable] catch(error) — instanceof Error guard before .message access
declare function sendBulkTemplate(opts: { templateId: string; recipientIds: string[] }): Promise<{ sent: number }>;
declare function logJobFailure(opts: { job: string; reason: string }): void;

async function processBulkSendJob(templateId: string, recipientIds: string[]): Promise<void> {
  try {
    const result = await sendBulkTemplate({ templateId, recipientIds });
    console.log(`Bulk send complete: ${result.sent} recipients`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    logJobFailure({ job: 'bulk-send-template', reason });
  }
}
