// Paraphrased FP shape for code-quality/deterministic/useless-constructor.
//
// A `private` constructor is NOT useless — it prevents external
// instantiation (e.g. singleton pattern, sealed factories). A
// `protected` constructor restricts construction to subclasses.
// Removing either would expose the default public constructor and
// break that contract.

abstract class BaseProvider {
  protected ready = false;
}

export class SealedProvider extends BaseProvider {
  private constructor() {
    super();
  }

  static create(): SealedProvider {
    return new SealedProvider();
  }
}

export class SubclassableBase extends BaseProvider {
  protected constructor(label: string) {
    super();
    this.ready = label.length > 0;
  }
}
