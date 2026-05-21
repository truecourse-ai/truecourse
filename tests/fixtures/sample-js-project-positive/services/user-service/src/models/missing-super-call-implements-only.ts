// FP shape for `bugs/deterministic/missing-super-call`: a class that
// `implements` an interface but does not extend any base class. There is no
// super constructor to call (and `super()` would be a TS error), so the rule
// must not treat the `implements` clause as triggering the derived-class
// requirement.

export interface Coord {
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
}

export class Sample implements Coord {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly timestamp: number = 0,
  ) {
    // Parameter-property assignments are emitted by TS — no body needed.
  }

  public distanceTo(other: Coord): number {
    return Math.sqrt((other.x - this.x) ** 2 + (other.y - this.y) ** 2);
  }
}
