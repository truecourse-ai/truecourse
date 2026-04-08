export function alwaysReturn(x: number): number { if (x > 0) return x; return 0; }
export const normalString = 'hello world';
export function addNumbers(a: number, b: number): number { return a + b; }
export function safeParse(): unknown { try { return JSON.parse('{}'); } catch { return null; } }
export function staticRegex(): RegExp { return /hello/u; }
export const letterRegex = /\p{Letter}/u;
export class ReadAttribute {
  private readonly data_: string;
  constructor(initial: string = 'secret') { this.data_ = initial; }
  getData(): string { return this.data_; }
}
