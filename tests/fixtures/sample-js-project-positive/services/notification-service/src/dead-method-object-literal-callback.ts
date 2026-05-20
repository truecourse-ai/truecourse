/**
 * Object-literal callback properties are invoked through the consuming
 * framework / typed contract, not via direct call sites the analyzer can
 * see. They must not be flagged dead-method.
 */

type ClientTransformer = {
  serialize: (data: unknown) => string;
  deserialize: (data: string) => unknown;
};

// 1. Object literal property functions on a const annotated with an
//    interface type — the consumer calls them through the interface.
const transformer: ClientTransformer = {
  serialize: (data) => String(data),
  deserialize: (data) => data,
};

type PipelineOptions = {
  headers: (input: { id: string }) => Record<string, string>;
  transform: ClientTransformer;
};

export function buildPipeline(opts: PipelineOptions): PipelineOptions {
  return opts;
}

// 2. Object literal property function passed inline to a factory call —
//    the factory invokes the callback via the consumed object.
export const pipeline = buildPipeline({
  headers: (input) => ({ 'x-trace-id': input.id }),
  transform: transformer,
});

type ScheduledJobSpec = {
  id: string;
  handler: (payload: { value: number }) => string;
};

// 3. Object literal property function on a const with `satisfies` clause —
//    the satisfied interface defines the callable surface used by the runtime.
export const scheduledJob = {
  id: 'sample.compute',
  handler: ({ value }) => String(value),
} as const satisfies ScheduledJobSpec;
