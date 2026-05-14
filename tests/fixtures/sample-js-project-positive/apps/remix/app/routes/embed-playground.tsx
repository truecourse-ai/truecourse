
// typeof guard to validate API response field is a string — type assertion, not secret comparison
declare const fetchPresignToken: (apiToken: string) => Promise<unknown>;

export async function exchangeApiToken(apiToken: string): Promise<string> {
  const data = await fetchPresignToken(apiToken);
  const presignToken = (data as Record<string, unknown>)?.token;

  if (!presignToken || typeof presignToken !== 'string') {
    throw new Error(`Unexpected response shape: ${JSON.stringify(data)}`);
  }

  return presignToken;
}


// FP shape: JSON.stringify used to display raw webhook event data in a debug playground —
// standard built-in serialisation, not a restricted API in any meaningful context.
declare const webhookEventLog: Array<{ type: string; payload: unknown; receivedAt: number }>;

export function renderWebhookEventDebugPanel(eventIndex: number): string {
  const event = webhookEventLog[eventIndex];

  if (!event) {
    return 'No event at index ' + eventIndex;
  }

  const formatted = JSON.stringify(event.payload, null, 2);
  return `[${event.type}] @ ${new Date(event.receivedAt).toISOString()}\n${formatted}`;
}



// FP shape: location.href used directly for navigation in playground redirect — direct location mutation
export function redirectPlayground(path: string): void {
  location.href = path;
}

