/**
 * Positive fixture for architecture/deterministic/declarations-in-global-scope.
 *
 * Test files routinely cache server / fixture handles at module scope —
 * singleton-per-worker is the intended pattern (vitest project setup,
 * jest globalSetup, playwright fixtures). The "shared mutable global"
 * concern doesn't apply: there's no concurrent request flow in a test
 * file, only sequential `it` callbacks reusing the same setup.
 */

interface Harness {
  baseUrl: string;
}

let cached: Harness | undefined;

export function getHarness(): Harness {
  if (cached) return cached;
  cached = { baseUrl: 'http://localhost' };
  return cached;
}
