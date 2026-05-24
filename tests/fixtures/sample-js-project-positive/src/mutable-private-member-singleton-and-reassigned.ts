/**
 * Positive fixture for code-quality/deterministic/mutable-private-member.
 *
 * Two shapes the rule must not flag:
 *
 *   1. **Lazy singleton.** A `private static _instance` field with no
 *      inline initializer is the canonical singleton pattern — the
 *      field gets assigned from a static factory method via
 *      `ClassName._instance = …`, which `readonly` would disallow.
 *
 *   2. **Initialized field that is also reassigned in a method.** An
 *      `= []` (or any inline initializer) IS an effective write, so a
 *      later `this.field = …` brings the total to two — the field is
 *      genuinely mutable and `readonly` would break it.
 */

type ChangeHandler = (cleared: boolean) => void;

export class SignaturePadController {
  private static _instance: SignaturePadController;

  private onChangeHandlers: ChangeHandler[] = [];

  private constructor() {}

  static getInstance(): SignaturePadController {
    if (!SignaturePadController._instance) {
      SignaturePadController._instance = new SignaturePadController();
    }
    return SignaturePadController._instance;
  }

  registerOnChange(handler: ChangeHandler): void {
    this.onChangeHandlers.push(handler);
  }

  removeOnChange(handler: ChangeHandler): void {
    this.onChangeHandlers = this.onChangeHandlers.filter((h) => h !== handler);
  }

  fire(cleared: boolean): void {
    this.onChangeHandlers.forEach((h) => h(cleared));
  }
}
