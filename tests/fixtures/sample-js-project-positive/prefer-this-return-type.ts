// A method whose declared return type is the class name but which returns a
// brand-new instance (not `this`) is NOT a candidate for a `this` return type —
// declaring the concrete class is correct. These must not be flagged.

export class TreeNode {
  constructor(private readonly label: string) {}

  // Builds a separate child node — the result is a distinct object, so the
  // return type is the class, not `this`.
  withChild(suffix: string): TreeNode {
    return new TreeNode(`${this.label}/${suffix}`)
  }
}

export class RangeCursor {
  constructor(private readonly path: string) {}

  // Returns a clone scoped to a segment — a new object, never `this`.
  forSegment(index: number): RangeCursor {
    return new RangeCursor(`${this.path}/segment_${index}`)
  }
}
