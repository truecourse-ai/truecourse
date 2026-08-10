// Paraphrased true-bug for bugs/deterministic/duplicate-class-members.
//
// Two instance methods with the same name — the second overwrites the
// first silently. This is the actual case the rule is meant to catch.

// VIOLATION: bugs/deterministic/duplicate-class-members
export class WidgetWriter {
  public describe(): string {
    return 'first';
  }
  public describe(): string {
    return 'second';
  }
}
