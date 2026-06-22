// A key/value store client exposes an `eval` method for running
// server-side scripts (the store's own scripting primitive, e.g. a Lua
// script). A bare member call like `store.eval(script, ...)` is the
// store's method — not the global `eval()` the rule is meant to flag.
// The rule must only fire on the global `eval(...)` identifier call, so
// wrapping `store.eval(...)` should produce no violation.

interface ScriptableStore {
  eval(script: string, keyCount: number): Promise<number>;
}

export function runCounterScript(store: ScriptableStore, script: string): Promise<number> {
  return store.eval(script, 0);
}
