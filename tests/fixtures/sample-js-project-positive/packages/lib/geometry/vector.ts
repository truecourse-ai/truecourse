
export type Vec2Like = {
  x: number;
  y: number;
};

export class Vec2 implements Vec2Like {
  public x: number;
  public y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  public lengthTo(other: Vec2Like): number {
    return Math.sqrt((other.x - this.x) ** 2 + (other.y - this.y) ** 2);
  }

  public equals(other: Vec2Like): boolean {
    return this.x === other.x && this.y === other.y;
  }
}



export type Coord2dLike = { x: number; y: number; t: number };

export class Coord2d implements Coord2dLike {
  public x: number;
  public y: number;
  public t: number;

  constructor(x: number, y: number, t?: number) {
    this.x = x;
    this.y = y;
    this.t = t ?? Date.now();
  }

  public distanceTo(other: Coord2dLike): number {
    return Math.sqrt((other.x - this.x) ** 2 + (other.y - this.y) ** 2);
  }
}
