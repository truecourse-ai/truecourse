
declare interface JobProvider {
  getApiHandler(): (req: Request) => Promise<Response>;
  getQueueHandler(): (payload: unknown) => Promise<void>;
}

class JobClient {
  constructor(private provider: JobProvider) {}

  getApiHandler() {
    return this.provider.getApiHandler();
  }

  getQueueHandler() {
    return this.provider.getQueueHandler();
  }
}
