
// [unknown-catch-variable] catch(err) — console.error(err) then throws new Error with fixed message
declare function dispatchWebhookPayload(url: string, payload: unknown): Promise<{ status: number }>;

async function triggerWebhookNotification(url: string, payload: unknown): Promise<void> {
  try {
    const response = await dispatchWebhookPayload(url, payload);
    if (response.status >= 400) {
      throw new Error(`Webhook returned status ${response.status}`);
    }
  } catch (err) {
    console.error(err);
    throw new Error('Failed to trigger webhook notification');
  }
}
