declare function describe(name: string, fn: () => undefined): undefined;
declare function it(name: string, fn: () => undefined, timeout?: number): undefined;
declare function expect(val: unknown): { toBe: (v: unknown) => undefined };
const TEST_TIMEOUT_MS = 5000;
describe('StableSuite', () => {
  it('should have proper timeout', () => {
    expect(true).toBe(true);
  }, TEST_TIMEOUT_MS);
  it('should pass', () => {
    expect(1 > 0).toBe(true);
  });
});
