// A fluent builder whose method returns `this` for chaining but declares the
// concrete class as the return type. Subclasses lose chaining because the type
// narrows to the parent — the return type should be `this`.

export class FilterBuilder {
  private readonly conditions: string[] = []

  // VIOLATION: code-quality/deterministic/prefer-this-return-type
  where(condition: string): FilterBuilder {
    this.conditions.push(condition)
    return this
  }

  build(): string {
    return this.conditions.join(' AND ')
  }
}
