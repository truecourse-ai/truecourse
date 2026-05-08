/**
 * this-before-super + missing-super-call shapes that should NOT fire:
 *
 * Class declares `implements <Interface>` only — there is no
 * superclass to call `super()` on, so neither rule applies.
 * The audit listed both rules firing on `MailChannelsTransport
 * implements Transport` in documenso/packages/email/transports/mailchannels.ts.
 */

interface Transport {
  readonly name: string;
  send(payload: { to: string; subject: string }): Promise<void>;
}

export class MailChannelsTransport implements Transport {
  public readonly name = "mailchannels";
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async send(payload: { to: string; subject: string }): Promise<void> {
    if (!this.endpoint) throw new Error("no endpoint");
    if (!payload.to) throw new Error("no recipient");
  }
}
