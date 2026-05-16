function doSideEffect_b6a3f062(x: number): void { /* noop */ }
export function caller_b6a3f062(): unknown {
  return doSideEffect_b6a3f062(1) as unknown;
}
