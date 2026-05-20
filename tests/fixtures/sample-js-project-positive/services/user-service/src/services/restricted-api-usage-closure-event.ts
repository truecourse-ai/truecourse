interface WebhookPayload {
  readonly type: string;
  readonly data: Record<string, string>;
}

function constructEvent(): WebhookPayload {
  return { type: 'demo.created', data: { id: 'demo-1' } };
}

export function handleWebhook(): { kind: string; payload: Record<string, string> } | null {
  const event = constructEvent();

  const branchOnType = (matcher: (kind: string) => boolean): { kind: string; payload: Record<string, string> } | null => {
    if (matcher(event.type)) {
      return { kind: event.type, payload: event.data };
    }
    return null;
  };

  return branchOnType((kind) => kind === 'demo.created');
}

export function trackInteraction(): string[] {
  const out: string[] = [];
  const capture = (event: string, properties: Record<string, unknown>): void => {
    const formatPayload = (data: Record<string, unknown>): string => {
      return `${event}:${JSON.stringify(data)}`;
    };
    out.push(formatPayload(properties));
  };
  capture('demo-event', { ok: true });
  return out;
}
