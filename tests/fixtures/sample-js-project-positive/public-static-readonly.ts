// Static public fields declared without an initializer are mutable slots
// (assignment points for consumers, lazily-populated caches), not constants —
// they cannot be `readonly` and must not be flagged.

export class Registry {
  constructor(readonly id: string = 'default') {}

  // Assignment point for consumers — declared without an initializer.
  static onError: (message: string, detail?: unknown) => void

  // Lazily-populated singleton slot, assigned the first time the getter runs.
  static cached: Registry | undefined

  static get current(): Registry {
    if (!Registry.cached) {
      Registry.cached = new Registry()
    }
    return Registry.cached
  }
}
