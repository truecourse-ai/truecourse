/**
 * Positive fixture for bugs/deterministic/unbound-method.
 *
 * `this.<name>` used as a value is only an unbound-method hazard when `<name>`
 * is an actual method that loses its receiver when detached. Here `this` is the
 * receiver of a plain `function` expression (no class) and `flag` is a boolean
 * data property — reading it and passing it as an argument detaches nothing, so
 * the rule must not fire.
 */

interface Toggle {
  flag: boolean;
}

declare function applyState(name: string, value: boolean): void;

export function attach(toggle: Toggle): void {
  const onChange = function (this: Toggle): void {
    applyState('checked', this.flag);
  };

  Reflect.apply(onChange, toggle, []);
}
