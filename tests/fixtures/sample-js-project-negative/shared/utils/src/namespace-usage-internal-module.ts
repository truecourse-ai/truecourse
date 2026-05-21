/**
 * First-party TS namespace used as an internal module — the deprecated
 * pre-ES2015 form. Should be flagged so the team migrates to ES module
 * exports.
 */

// VIOLATION: code-quality/deterministic/namespace-usage
namespace MathHelpers {
  export const square = (n: number): number => n * n;
  export const cube = (n: number): number => n * n * n;
}

export const four = MathHelpers.square(2);
export const eight = MathHelpers.cube(2);
