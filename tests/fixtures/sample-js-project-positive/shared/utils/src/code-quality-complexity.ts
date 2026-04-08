export function categorizeSize(x: number): string { if (x > 0) return 'big'; return 'small'; }
export function checkBoth(a: boolean, b: boolean): boolean { return a && b; }
export function getSign(x: number): string { if (x > 0) return 'positive'; return 'non-positive'; }
export function placeholder(): null { return null; }
export function compute(): string { return 'result'; }
export function calculate(a: number, b: number): number { return a + b; }
export class PropertyStore {
  private readonly _name = '';
  get name(): string { return this._name; }
}
