// A method that returns a freshly-constructed instance of its own class
// is correctly typed with the concrete class name — the value handed back
// is a *different* object, not the receiver. Annotating such a method with
// `this` would be wrong. The rule must only flag methods that actually
// `return this` for chaining; factory/clone methods that build and return a
// new instance are not candidates.

interface ScopeOptions {
  readonly prefix: string;
  readonly tag: string;
}

export class NamingScope {
  private readonly prefix: string;
  private readonly tag: string;

  constructor(options: ScopeOptions) {
    this.prefix = options.prefix;
    this.tag = options.tag;
  }

  childScope(segment: string): NamingScope {
    return new NamingScope({ prefix: `${this.prefix}/${segment}`, tag: this.tag });
  }

  cloneDetached(): NamingScope {
    return new NamingScope({ prefix: this.prefix, tag: this.tag });
  }
}
