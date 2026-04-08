export function properDeclaration(): number { return 2; }
export function scopedCase(x: number): string {
  if (x === 1) return 'one';
  if (x === 2) return 'two';
  return 'other';
}
export function properArgs(x: number): number { return x * 2; }
export function properSwitch(x: number): string {
  if (x === 1) return 'one';
  if (x === 2) return 'matched';
  return 'default';
}
