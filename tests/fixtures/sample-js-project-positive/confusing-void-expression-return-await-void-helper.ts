// Paraphrased positive fixture for code-quality/deterministic/confusing-void-expression.
//
// `return await voidFn()` from a non-arrow function whose own signature
// resolves to Promise<void> is the idiomatic shape for async helpers and
// class-method delegations — the `await` is deliberate (preserves the
// stack trace; lets the caller observe completion), and the void return
// is deliberate (the outer signature is void), so the call site is not
// confusing.

async function dispatchEvent(_op: string, _id: string): Promise<void> {
  await Promise.resolve();
}

// function_declaration with explicit Promise<void> return.
export async function cancelOnce(id: string): Promise<void> {
  return await dispatchEvent('cancel', id);
}

// method_definition with explicit Promise<void> return.
export class CancelService {
  private readonly source: string;
  constructor(source: string) {
    this.source = source;
  }
  public async cancel(id: string): Promise<void> {
    return await dispatchEvent(this.source, id);
  }
}
