
class WebhookDispatcher {
  private static _instance: WebhookDispatcher | undefined;

  private constructor(private readonly endpoint: string) {}

  static getInstance(): WebhookDispatcher {
    if (!WebhookDispatcher._instance) {
      WebhookDispatcher._instance = new WebhookDispatcher(process.env.WEBHOOK_URL ?? '');
    }
    return WebhookDispatcher._instance;
  }

  async dispatch(event: string, payload: unknown): Promise<void> {
    console.log(this.endpoint, event, payload);
  }
}
