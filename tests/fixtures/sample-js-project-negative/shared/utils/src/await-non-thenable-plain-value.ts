/**
 * Negative fixture: `await` on a plainly-typed primitive does nothing —
 * the `await` either masks a misplaced async/await intent or signals that
 * the author misremembered the value's shape.
 */

export async function shoutLabel(value: string): Promise<string> {
  // VIOLATION: bugs/deterministic/await-non-thenable
  const resolved = await value;
  return resolved.toUpperCase();
}
