/**
 * mutable-private-member shape that should NOT fire:
 *
 * Private static singleton-instance field. The lazy-init pattern
 * assigns to `ClassName._instance = new ClassName()` inside a
 * static `getInstance()` method. The rule only tracked
 * `this._instance =` and missed the static assignment, so it
 * suggested `readonly` — which would break the lazy init.
 */

export class Singleton {
  private static _instance: Singleton | null = null;
  private value: number;

  private constructor() {
    this.value = 0;
  }

  static getInstance(): Singleton {
    if (Singleton._instance === null) {
      Singleton._instance = new Singleton();
    }
    return Singleton._instance;
  }

  read(): number {
    return this.value;
  }

  bump(): void {
    this.value++;
  }
}
