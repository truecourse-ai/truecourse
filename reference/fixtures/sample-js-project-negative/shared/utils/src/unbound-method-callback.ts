/**
 * Paraphrased true-bug for bugs/deterministic/unbound-method.
 *
 * Passing `this.handleItem` (a real method) into `forEach` strips its
 * `this` binding; the callback runs with `this === undefined` in strict
 * mode (or the global object otherwise) and any state read inside
 * blows up.
 */

export class BatchProcessor {
  private readonly tag = 'batch';

  process(items: readonly string[]): void {
    // VIOLATION: bugs/deterministic/unbound-method
    items.forEach(this.handleItem);
  }

  // Second paraphrased true-bug at a distinct call site: `this.handleItem`
  // resolves to a real method_definition, so detaching it as a bare callback
  // value loses the receiver — the case the rule must keep catching.
  dispatch(batch: readonly string[]): void {
    // VIOLATION: bugs/deterministic/unbound-method
    batch.forEach(this.handleItem);
  }

  handleItem(item: string): void {
    console.log(`${this.tag}: ${item}`);
  }
}
