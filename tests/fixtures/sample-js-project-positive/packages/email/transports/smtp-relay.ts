interface SmtpRelayOptions {
  endpoint: string;
  apiKey?: string;
}

declare function fetch(url: string, opts: object): Promise<Response>;

export class SmtpRelayTransport {
  constructor(private _options: SmtpRelayOptions) {}

  async sendMail(payload: object): Promise<void> {
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this._options.apiKey) {
      requestHeaders['X-Auth-Token'] = this._options.apiKey;
    }

    await fetch(this._options.endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(payload),
    });
  }
}
