
// [unknown-catch-variable] catch(err) — never used; generic toast in webhook edit dialog
declare function updateWebhookEndpoint(opts: { webhookId: string; url: string; events: string[] }): Promise<void>;
declare const webhookId: string;
declare const webhookToast: (opts: { title: string; description: string; variant?: string }) => void;
declare function closeEditDialog(): void;

async function handleWebhookUpdate(url: string, events: string[]): Promise<void> {
  try {
    await updateWebhookEndpoint({ webhookId, url, events });
    webhookToast({ title: 'Webhook updated', description: 'Your webhook has been updated successfully.' });
    closeEditDialog();
  } catch (err) {
    webhookToast({
      title: 'Update failed',
      description: 'We could not update the webhook. Please try again.',
      variant: 'destructive',
    });
  }
}
