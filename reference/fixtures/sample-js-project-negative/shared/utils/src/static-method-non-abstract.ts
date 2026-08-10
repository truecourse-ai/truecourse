/**
 * Negative fixture for code-quality/deterministic/static-method-candidate.
 *
 * Methods on a *non-abstract* class that never reference `this`/`super` are
 * still legitimate static-method candidates — the abstract-class skip added to
 * suppress base-provider FPs must not also silence concrete classes.
 */

export class CaseHelpers {
  // VIOLATION: code-quality/deterministic/static-method-candidate
  public titleCase(input: string): string {
    return input.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  }
}
