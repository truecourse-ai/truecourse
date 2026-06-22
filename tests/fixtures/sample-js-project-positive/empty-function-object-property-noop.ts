// Empty arrow functions provided as object-property values are intentional
// no-op placeholders — e.g. default `cleanup` / `onEvent` handlers that
// satisfy an interface or config slot. The empty body is the whole point,
// so neither empty-function nor no-empty-function should flag them.
export const lifecycleHooks = {
  cleanup: () => {},
  onEvent: () => {},
};
