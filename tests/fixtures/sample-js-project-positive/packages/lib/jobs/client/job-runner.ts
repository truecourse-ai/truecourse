interface ZodSchema<T> {
  parse(data: unknown): T;
}

interface JobDefinition<T> {
  name: string;
  trigger: {
    schema?: ZodSchema<T>;
  };
  handler: (opts: { payload: T }) => Promise<void>;
}

export function createJobRunner<T>(job: JobDefinition<T>) {
  return async (rawPayload: unknown) => {
    let payload = rawPayload as T;

    if (job.trigger.schema) {
      payload = job.trigger.schema.parse(rawPayload);
    }

    await job.handler({ payload });
  };
}
