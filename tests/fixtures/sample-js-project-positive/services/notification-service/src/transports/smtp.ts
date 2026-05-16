declare function sendHttpRequest(url: string, body: string): Promise<{ status: number; json: () => Promise<{ message: string }> }>;
declare function onSuccess(): void;
declare function onFailure(err: Error): void;

async function dispatchEmail(url: string, payload: string) {
  const res = await sendHttpRequest(url, payload);
  if (res.status >= 200 && res.status <= 299) {
    onSuccess();
    return;
  }
  const data = await res.json();
  onFailure(new Error(`Mail send failed: ${data.message}`));
}


// FP shape: callback-style nodemailer Transport — `return callback(...)` is idiomatic
// early-exit guard in a void-returning method; no caller reads the return value.
declare type MailEnvelope = { data: { to?: string; from?: string; subject?: string; html?: string } };
declare type DeliveryInfo = { messageId: string; accepted: string[] };
declare type TransportCallback = (err: Error | null, info: DeliveryInfo | null) => void;

class MailChannelsTransport {
  name = 'mailchannels';
  version = '1.0.0';

  public send(mail: MailEnvelope, callback: TransportCallback): void {
    if (!mail.data.to) {
      return callback(new Error('Missing required field "to"'), null);
    }

    if (!mail.data.from) {
      return callback(new Error('Missing required field "from"'), null);
    }

    if (!mail.data.subject) {
      return callback(new Error('Missing required field "subject"'), null);
    }

    fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.data.to }] }],
        from: { email: mail.data.from },
        subject: mail.data.subject,
        content: [{ type: 'text/html', value: mail.data.html ?? '' }],
      }),
    })
      .then(() => callback(null, { messageId: `${Date.now()}@mailchannels.net`, accepted: [mail.data.to!] }))
      .catch((err: Error) => callback(err, null));
  }
}

