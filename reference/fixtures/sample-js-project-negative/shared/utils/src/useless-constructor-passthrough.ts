// True-bug shape: a public constructor that only forwards its args to
// `super()` is redundant — the parent constructor would be inherited
// automatically.

class BaseHandler {
  constructor(public name: string) {}
}

export class ChildHandler extends BaseHandler {
  // VIOLATION: code-quality/deterministic/useless-constructor
  constructor(name: string) {
    super(name);
  }
}
