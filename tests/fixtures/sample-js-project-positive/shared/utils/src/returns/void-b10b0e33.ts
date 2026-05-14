function doSideEffect_b10b0e33(x: number): void { /* noop */ }
export function caller_b10b0e33(): unknown {
  return doSideEffect_b10b0e33(1) as unknown;
}
