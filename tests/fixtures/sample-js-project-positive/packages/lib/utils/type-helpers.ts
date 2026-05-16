
// --- readonly-parameter-types FP: (...args: any[]) => infer Output in conditional type ---
// This is inside a conditional/infer context, not a real callable parameter
type AsyncReturnType<T> = T extends (...args: any[]) => Promise<infer R> ? R : never;
type UnwrapFunction<T> = T extends (...args: any[]) => infer Output ? Awaited<Output> : T;

export type ExtractLoaderData<T> = T extends (...args: any[]) => infer Output
  ? Awaited<Output>
  : Awaited<T>;
