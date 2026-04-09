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
export class ArrowMethodClass {
  private readonly handleClick = (): boolean => true;
  getHandler(): () => boolean { return this.handleClick; }
}

// inconsistent-return: exhaustive switch where all cases return
export function exhaustiveSwitch(action: string): string {
  switch (action) {
    case 'start': return 'starting';
    case 'stop': return 'stopping';
    default: return 'unknown';
  }
}

// await-non-thenable: async function awaiting a method call on an object
export async function callMethod(client: { invoke: (s: string) => Promise<string> }): Promise<string> {
  try {
    return await client.invoke('test');
  } catch {
    return 'error';
  }
}

// constant-binary-expression: ternary on a nullable variable
export function nullableTernary(value: string | null): string {
  return value ? value.toUpperCase() : 'default';
}
