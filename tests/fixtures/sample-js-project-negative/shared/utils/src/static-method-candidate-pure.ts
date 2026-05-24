/**
 * Paraphrased true-bug for code-quality/deterministic/static-method-candidate.
 *
 * A method that does not use `this` (or `super`) anywhere — including
 * inside any nested arrow callback — is a candidate to be made static
 * or extracted as a standalone function.
 */

type Point = { x: number; y: number };

export class GeometryHelpers {
  // No `this` anywhere — pure transformation of inputs.
  // VIOLATION: code-quality/deterministic/static-method-candidate
  midpoints(points: Point[]): Point[] {
    const mids: Point[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    return mids;
  }
}
