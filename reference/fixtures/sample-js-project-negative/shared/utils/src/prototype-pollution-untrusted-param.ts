/**
 * Paraphrased true-bug for bugs/deterministic/prototype-pollution.
 *
 * The setter takes an arbitrary string `key` from its caller and writes
 * directly into `target[key]` without checking for `__proto__` /
 * `constructor` / `prototype`. A caller passing `"__proto__"` mutates the
 * prototype chain instead of the target object.
 */

export function setEntry(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  // VIOLATION: bugs/deterministic/prototype-pollution
  target[key] = value;
}
