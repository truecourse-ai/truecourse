
declare function removeWebhookSubscription(subscriptionId: string): Promise<void>;

async function unsubscribeWebhook(subscriptionId: string): Promise<void> {
  try {
    await removeWebhookSubscription(subscriptionId);
  } catch (err) {
    console.error(err);
  }
}



declare function listDocumentsForWebhook(subscriptionId: string, page: number): Promise<{ id: string; title: string }[]>;

async function fetchWebhookDocuments(
  subscriptionId: string,
  page: number,
): Promise<{ id: string; title: string }[] | null> {
  try {
    return await listDocumentsForWebhook(subscriptionId, page);
  } catch (err) {
    console.error(err);
    return null;
  }
}
