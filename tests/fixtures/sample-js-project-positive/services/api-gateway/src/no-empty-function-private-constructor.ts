// Positive: code-quality/deterministic/no-empty-function
//
// `private constructor() {}` and `protected constructor() {}` are the
// canonical singleton / abstract-base patterns — the empty body is the
// whole point (block direct instantiation, force callers to go through
// the static factory). The rule must not flag them as a missing
// implementation.

export class Singleton {
  private constructor() {}

  static create(): Singleton {
    return new Singleton();
  }
}

export abstract class BaseLogger {
  protected constructor() {}

  abstract log(message: string): void;
}
