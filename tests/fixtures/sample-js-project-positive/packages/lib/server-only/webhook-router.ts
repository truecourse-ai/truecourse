
type WebhookEvent = { id: string; eventType: string; payload: unknown };
type WebhookConfig = { id: string; url: string; eventTriggers: string[] };

declare function findWebhooks(teamId: string): Promise<WebhookConfig[]>;
declare function processWebhookEvents(config: WebhookConfig, events: WebhookEvent[]): Promise<void>;

async function syncWebhookEvents(teamId: string, incomingEvents: WebhookEvent[], existingEventIds: string[]) {
  const configs = await findWebhooks(teamId);

  const newEvents = incomingEvents.filter(
    (event) => !existingEventIds.some((id) => id === event.id),
  );

  const removedEventIds = existingEventIds.filter(
    (id) => !incomingEvents.some((event) => event.id === id),
  );

  for (const config of configs) {
    await processWebhookEvents(config, newEvents);
  }

  return { added: newEvents.length, removed: removedEventIds.length };
}
