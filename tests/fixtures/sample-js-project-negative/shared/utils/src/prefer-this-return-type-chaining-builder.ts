// Paraphrased true-bug for code-quality/deterministic/prefer-this-return-type.
//
// The method returns `this` to support fluent chaining, but its return type
// is annotated with the concrete class name. A subclass that chains off this
// method would have its type narrowed back to the parent — the annotation
// should be `this` instead of the class name.

// VIOLATION: code-quality/deterministic/prefer-this-return-type
export class HeaderBuilder {
  private readonly entries: string[] = [];

  add(entry: string): HeaderBuilder {
    this.entries.push(entry);
    return this;
  }

  build(): string {
    return this.entries.join('\n');
  }
}
