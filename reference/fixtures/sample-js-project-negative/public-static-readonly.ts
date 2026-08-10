// A public static field initialized with a constant value should be `readonly`
// so it cannot be reassigned elsewhere.

export class HttpClient {
  // VIOLATION: code-quality/deterministic/public-static-readonly
  static DEFAULT_TIMEOUT_MS = 5000

  timeout(): number {
    return HttpClient.DEFAULT_TIMEOUT_MS
  }
}
