/**
 * Paraphrased true-bug for code-quality/deterministic/unused-private-member.
 *
 * Hand-written class with a private field that's set in the constructor
 * but never read — dead state.
 */

export class Salutation {
  // VIOLATION: code-quality/deterministic/unused-private-member
  private fallbackLocale: string = 'en-US';

  greet(name: string): string {
    return `hello ${name}`;
  }
}
