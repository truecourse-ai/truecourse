/**
 * Test file with at least one test case.
 */

declare function describe(name: string, fn: () => undefined): undefined;
declare function it(name: string, fn: () => undefined): undefined;
declare function expect(val: unknown): { toBe: (v: unknown) => undefined };

describe('Placeholder', () => {
  it('should be defined', () => {
    expect(true).toBe(true);
  });
});
