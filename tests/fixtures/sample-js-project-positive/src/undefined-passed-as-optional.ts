/**
 * Positive fixture for code-quality/deterministic/undefined-passed-as-optional.
 *
 * `f(x, undefined)` (two args) and `g(undefined)` (one arg) are NOT
 * redundant-trailing-optional patterns: with so few arguments the trailing
 * `undefined` is almost always a meaningful "clear" value handed to a
 * required parameter (form setters, event handlers, context defaults).
 * The rule should only fire when the call has a longer argument list and
 * the trailing `undefined` is genuinely past a series of provided args.
 */

type FormApi = {
  setValue(name: string, value: string | undefined): void;
};

type FieldApi = {
  onChange(value: string | undefined): void;
};

type ProfileMeta = { brand: string; nickname: string | undefined };

function buildProfileMeta(
  brand: string,
  override: { nickname?: string } | undefined,
): ProfileMeta {
  return { brand, nickname: override?.nickname };
}

function makeContext<T>(defaultValue: T): { defaultValue: T } {
  return { defaultValue };
}

export function clearFormField(form: FormApi): void {
  // 2-arg call: the value parameter is required; undefined is a meaningful clear.
  form.setValue('subject', undefined);
}

export function resetFieldValue(field: FieldApi): void {
  // 1-arg call: the only argument is required.
  field.onChange(undefined);
}

export function makeBrandingContext(): { defaultValue: string | undefined } {
  // 1-arg call: createContext's defaultValue is required.
  return makeContext<string | undefined>(undefined);
}

export function defaultProfileMeta(brand: string): ProfileMeta {
  // 2-arg call: both arguments are required even though the 2nd accepts undefined.
  return buildProfileMeta(brand, undefined);
}
