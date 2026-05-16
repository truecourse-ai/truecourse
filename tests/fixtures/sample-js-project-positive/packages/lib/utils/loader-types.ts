
// --- readonly-parameter-types FP: ...args: any[] in function type alias (not a real param) ---
type AppData = any;
type DataFunction = (...args: any[]) => unknown;
type DataOrFunction = AppData | DataFunction;

export type UseDataFunctionReturn<T extends DataOrFunction> = T extends (...args: any[]) => infer Output
  ? Awaited<Output>
  : Awaited<T>;
