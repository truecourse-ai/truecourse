
// FP shape: Object.values/keys called on typed objects to check emptiness; no type mismatch
declare const payload: Record<string, unknown>;
declare const metadata: Record<string, string>;

function isNoop(): boolean {
  return Object.values(payload).length === 0 && Object.keys(metadata).length === 0;
}
