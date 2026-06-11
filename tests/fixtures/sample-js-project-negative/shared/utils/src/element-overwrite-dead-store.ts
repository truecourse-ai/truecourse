// Paraphrased true-bug for bugs/deterministic/element-overwrite.
//
// The same object property is assigned twice in a row with no read in
// between and without the second assignment consuming the first. The first
// write is dead — it is overwritten before it is ever observed.

interface Settings {
  retries: number;
}

export function configure(settings: Settings, value: number): void {
  // VIOLATION: bugs/deterministic/element-overwrite
  settings.retries = value;
  settings.retries = value + value;
}
