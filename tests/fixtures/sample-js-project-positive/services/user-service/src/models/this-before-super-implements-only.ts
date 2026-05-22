// FP shape for `bugs/deterministic/this-before-super`: a class that
// `implements` an interface but does not extend any base class. `this` may
// be used freely inside the constructor — there is no super() to come
// before because there is no super class.

interface Transport<T> {
  send(payload: T): Promise<void>;
}

interface Options {
  apiKey: string;
  endpoint: string;
}

export class MailchannelsLikeTransport implements Transport<string> {
  private readonly options: Options;

  constructor(options: Partial<Options>) {
    const { apiKey = '', endpoint = '' } = options;
    this.options = { apiKey, endpoint };
  }

  public async send(payload: string): Promise<void> {
    if (this.options.apiKey.length === 0) {
      throw new Error('Missing API key');
    }
    await Promise.resolve(payload);
  }
}
