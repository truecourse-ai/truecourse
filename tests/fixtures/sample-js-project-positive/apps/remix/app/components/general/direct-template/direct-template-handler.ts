
// Error unused + rethrow: catch(err) shows generic toast and re-throws without accessing err properties
async function processDirectTemplateForm(templateToken: string, data: Record<string, unknown>): Promise<void> {
  try {
    await submitDirectTemplateResponse(templateToken, data);
  } catch (err) {
    showToast({ title: 'Submission failed', description: 'Please try again.', variant: 'destructive' });
    throw err;
  }
}

declare function submitDirectTemplateResponse(token: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant: string }): void;
