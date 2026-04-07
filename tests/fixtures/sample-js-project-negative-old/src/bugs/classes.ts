/**
 * Bug violations related to class patterns.
 */

// VIOLATION: bugs/deterministic/no-constructor-return
export class ConstructorReturn {
  value: number;
  constructor() {
    this.value = 42;
    return { value: 99 };
  }
}

// VIOLATION: bugs/deterministic/no-setter-return
export class SetterReturn {
  private _name = '';
  set name(val: string) {
    this._name = val;
    return val;
  }
  get name() {
    return this._name;
  }
}

// VIOLATION: bugs/deterministic/getter-missing-return
export class GetterMissingReturn {
  private _count = 0;
  get count() {
    this._count;
  }
}

// VIOLATION: bugs/deterministic/missing-super-call
export class Base {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

export class Child extends Base {
  age: number;
  constructor(name: string, age: number) {
    this.age = age;
  }
}

// VIOLATION: bugs/deterministic/this-before-super
export class ChildThisBeforeSuper extends Base {
  age: number;
  constructor(name: string, age: number) {
    this.age = age;
    super(name);
  }
}

// VIOLATION: bugs/deterministic/async-constructor
export class AsyncConstructor {
  data: any;
  async constructor() {
    this.data = await fetch('/api/data');
  }
}
