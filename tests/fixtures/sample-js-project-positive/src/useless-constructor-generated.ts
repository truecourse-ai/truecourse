// Generated from src/grammar/Bar.g4 by ANTLR 4.9.0-SNAPSHOT
// Do not edit — re-run the generator.

/**
 * Positive fixture for code-quality/deterministic/useless-constructor.
 *
 * Generator-produced parser-rule classes emit a constructor on every
 * subclass that just forwards `(parent, invokingState)` to
 * `super(parent, invokingState)`. Flagging this as "useless" floods the
 * report with noise the author can't act on — removing the constructor
 * means modifying generated output, and re-running the generator would
 * just put it back.
 */

export class GeneratedRuleContextBase {
  protected readonly parent: unknown;
  protected readonly invokingState: number;
  constructor(parent: unknown, invokingState: number) {
    this.parent = parent;
    this.invokingState = invokingState;
  }
}

export class GeneratedDeclarationContext extends GeneratedRuleContextBase {
  constructor(parent: unknown, invokingState: number) {
    super(parent, invokingState);
  }
}
