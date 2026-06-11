// A genuine dead store: the second assignment overwrites the property without
// ever reading the value the first assignment produced.

interface Settings {
  retries: number
}

function computeDefault(): number {
  return 3
}

export function configure(settings: Settings): Settings {
  settings.retries = computeDefault()
  // VIOLATION: bugs/deterministic/element-overwrite
  settings.retries = 5
  return settings
}
