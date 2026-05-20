import { buildPipeline } from './dead-method-object-literal-callback';

export function describePipeline(): string {
  const opts = buildPipeline({
    headers: () => ({}),
    transform: { serialize: (d) => String(d), deserialize: (d) => d },
  });
  return typeof opts.headers;
}
