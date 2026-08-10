/**
 * Paraphrased true-bug for code-quality/deterministic/useless-constructor.
 *
 * Hand-written subclass whose constructor only forwards the parent's
 * argument list to `super()`. Removing it doesn't change observable
 * behavior — the default constructor inherited from the parent would
 * do exactly the same thing.
 */

class GreeterBase {
  constructor(protected readonly name: string) {}
}

export class FriendlyGreeter extends GreeterBase {
  // VIOLATION: code-quality/deterministic/useless-constructor
  constructor(name: string) {
    super(name);
  }
}
