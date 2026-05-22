// Fresh negative case: a derived class that ALSO `implements` an interface,
// whose constructor uses `this` before calling super(). The presence of an
// `implements` clause must not mask the missing super() call when the class
// also extends a base.

class Base {
  public id: string;
  constructor(id: string) {
    this.id = id;
  }
}

interface Tagged {
  tag: string;
}

// VIOLATION: bugs/deterministic/missing-super-call
export class Subject extends Base implements Tagged {
  public tag: string;

  constructor(id: string, tag: string) {
    // Missing super(id) — derived constructor must call super() first.
    // @ts-ignore
    this.tag = tag;
    // @ts-ignore
    this.id = id;
  }
}
