// MODE shape-97cb92eef12a: private constructor invoked via `new ClassName()` inside a static `start`/factory method on the same class (license-client pattern).
export class LicenseClient {
  private static instance: LicenseClient | null = null;
  private licenseKey: string;

  private constructor() {
    this.licenseKey = '';
  }

  public static start(): LicenseClient {
    if (!LicenseClient.instance) {
      LicenseClient.instance = new LicenseClient();
    }
    return LicenseClient.instance;
  }

  public getLicenseKey(): string {
    return this.licenseKey;
  }
}

declare const licenseClient: LicenseClient;
void licenseClient.getLicenseKey();
void LicenseClient.start();

// MODE shape-7d8edf5cc316: private constructor with parameters invoked via `new BullMQJobProvider()` inside a static `getInstance()` factory (bullmq pattern).
interface BullMQOptions {
  redisUrl: string;
  prefix?: string;
}

export class BullMQJobProvider {
  private static instance: BullMQJobProvider | null = null;
  private readonly options: BullMQOptions;

  private constructor(options: BullMQOptions = { redisUrl: 'redis://localhost:6379' }) {
    this.options = options;
  }

  public static getInstance(): BullMQJobProvider {
    if (!BullMQJobProvider.instance) {
      BullMQJobProvider.instance = new BullMQJobProvider();
    }
    return BullMQJobProvider.instance;
  }

  public enqueue(jobName: string): void {
    void jobName;
    void this.options.redisUrl;
  }
}

declare const bullProvider: BullMQJobProvider;
bullProvider.enqueue('email');
void BullMQJobProvider.getInstance();

// MODE shape-0814a7718233: private constructor with destructured object param invoked via `new InngestJobProvider({ client })` inside static `getInstance()` (inngest pattern).
interface InngestClient {
  id: string;
  send(name: string): Promise<void>;
}

interface InngestProviderArgs {
  client: InngestClient;
}

export class InngestJobProvider {
  private static instance: InngestJobProvider | null = null;
  private readonly client: InngestClient;

  private constructor({ client }: InngestProviderArgs) {
    this.client = client;
  }

  public static getInstance(client: InngestClient): InngestJobProvider {
    if (!InngestJobProvider.instance) {
      InngestJobProvider.instance = new InngestJobProvider({ client });
    }
    return InngestJobProvider.instance;
  }

  public async dispatch(name: string): Promise<void> {
    await this.client.send(name);
  }
}

declare const inngestClient: InngestClient;
declare const inngestProvider: InngestJobProvider;
void InngestJobProvider.getInstance(inngestClient);
void inngestProvider.dispatch('user.created');
