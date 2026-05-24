/**
 * Positive fixture for code-quality/deterministic/static-method-candidate.
 *
 * Arrow-function callbacks inherit `this` lexically from the enclosing
 * method, unlike regular `function` expressions. A method that touches
 * `this` only inside an arrow callback is still an instance method —
 * making it `static` would break the `this` reference and the call
 * site that depends on it.
 */

export class CounterPipeline {
  private readonly offset: number;

  constructor(offset: number) {
    this.offset = offset;
  }

  // Uses `this.offset` only inside an arrow callback to `.map()`.
  // The rule must recurse into arrow bodies (arrows do not rebind
  // `this`) and see the reference.
  public shiftAll(values: readonly number[]): number[] {
    return values.map((v) => v + this.offset);
  }
}
