
// --- FP shape: dynamic import() in async job handler for lazy loading ---
declare const jobPayload: { userId: number; templateName: string };

async function handleSendEmail(): Promise<void> {
  const { renderEmail } = await import('./email-renderer');
  const html = renderEmail(jobPayload.templateName, { userId: jobPayload.userId });
  void html;
}
