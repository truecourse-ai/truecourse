
declare interface SmtpMessage { data: { to?: string; from?: string } }
declare interface SmtpSentInfo { messageId: string }
declare interface SmtpTransport<T> { name: string; version: string; send(mail: SmtpMessage, cb: (err: Error | null, info: T) => void): void }

const TRANSPORT_VERSION = '1.0.0';

export class SmtpRelayTransport implements SmtpTransport<SmtpSentInfo> {
  public name = 'SmtpRelayTransport';
  public version = TRANSPORT_VERSION;

  private _endpoint: string;
  private _apiKey: string;

  constructor(options: { endpoint?: string; apiKey?: string }) {
    const { endpoint = 'https://relay.example.com/send', apiKey = '' } = options;
    this._endpoint = endpoint;
    this._apiKey = apiKey;
  }

  public send(mail: SmtpMessage, callback: (err: Error | null, info: SmtpSentInfo) => void): void {
    if (!mail.data.to || !mail.data.from) {
      return callback(new Error('Missing required fields'), null as unknown as SmtpSentInfo);
    }
    callback(null, { messageId: 'stub' });
  }
}



declare interface OutboundTransport<T> { name: string; version: string }

const RELAY_VERSION = '2.0.0';

export class WebhookRelayTransport implements OutboundTransport<{ accepted: string[] }> {
  public name = 'WebhookRelayTransport';
  public version = RELAY_VERSION;

  private _webhookUrl: string;
  private _secret: string;

  constructor(options: { webhookUrl?: string; secret?: string }) {
    const { webhookUrl = 'https://hooks.example.com/relay', secret = '' } = options;
    this._webhookUrl = webhookUrl;
    this._secret = secret;
  }
}
