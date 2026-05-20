/**
 * Direct assignment with a user-supplied dynamic key — classic
 * prototype-pollution vector.
 */

export function setExternalProperty(target: Record<string, unknown>, userKey: string, value: unknown): void {
  // VIOLATION: bugs/deterministic/prototype-pollution
  target[userKey] = value;
}
