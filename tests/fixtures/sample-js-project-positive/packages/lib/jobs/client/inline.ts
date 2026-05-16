
declare type HonoContext = any;
declare const ZJobOptionsSchema: any;

class InlineJobProvider {
  private _jobs: Record<string, any> = {};

  getApiHandler(): (c: HonoContext) => Promise<Response | void> {
    return async (c: HonoContext) => {
      const req = c.req;

      if (req.method !== 'POST') {
        return c.text('Method not allowed', 405);
      }

      const jobId = req.header('x-job-id');
      const signature = req.header('x-job-signature');

      const options = await req
        .json()
        .then((data: any) => ZJobOptionsSchema.parseAsync(data))
        .catch(() => null);

      if (!options) {
        return c.text('Bad request', 400);
      }

      const definition = this._jobs[options.name];

      if (typeof jobId !== 'string' || typeof signature !== 'string') {
        return c.text('Bad request', 400);
      }

      if (!definition) {
        return c.text('Job not found', 404);
      }

      return c.text('OK', 200);
    };
  }
}
