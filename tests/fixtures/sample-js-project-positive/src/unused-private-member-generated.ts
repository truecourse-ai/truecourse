// Generated from src/grammar/Foo.g4 by ANTLR 4.9.0-SNAPSHOT
// Do not edit — re-run the generator.

/**
 * Positive fixture for code-quality/deterministic/unused-private-member.
 *
 * Generator-produced classes (ANTLR parsers/lexers, Protobuf stubs,
 * GraphQL Code Generator output) carry private scaffolding fields that
 * aren't referenced inside the class — they're written/read through
 * superclass machinery the analyzer can't trace. Flagging them as
 * "unused" floods the report with noise that's not the author's to fix.
 */

export class GeneratedParser {
  private readonly _atn: string = 'ATN serialized blob';
  private readonly _vocabulary: readonly string[] = ['TOKEN_A', 'TOKEN_B'];

  parse(input: string): string {
    return `${this.constructor.name}:${input}`;
  }
}
