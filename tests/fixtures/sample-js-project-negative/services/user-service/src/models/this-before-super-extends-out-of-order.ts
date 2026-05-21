// Fresh negative case: a derived class whose constructor accesses `this`
// before calling super(). The call to super() exists (so missing-super-call
// does not fire), but the ordering bug is exactly what this-before-super
// targets and a real ReferenceError at runtime.

class Animal {
  constructor(public readonly name: string) {}
}

// VIOLATION: bugs/deterministic/this-before-super
export class Dog extends Animal {
  public breed: string;

  constructor(name: string, breed: string) {
    // @ts-ignore
    this.breed = breed;
    super(name);
  }
}
