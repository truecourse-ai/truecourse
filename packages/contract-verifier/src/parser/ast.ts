/**
 * Generic AST produced by the parser. The DSL has many artifact-specific
 * shapes, but they all reduce to the same generic structure:
 *
 *   - A file is a sequence of top-level Statements.
 *   - A Statement = a list of HeadTokens followed by an optional Block.
 *   - A Block = a sequence of nested Statements.
 *   - HeadToken values cover identifiers, strings, numbers, ranges,
 *     references, lists, and a few operators.
 *
 * Per-artifact "lifters" walk this tree and produce typed Artifact
 * objects. Keeping the parser generic means new artifact types don't
 * require new parser code.
 */

export interface SrcLoc {
  filePath: string;
  line: number;
  col: number;
}

export interface FileNode {
  filePath: string;
  statements: StatementNode[];
}

export interface StatementNode {
  head: HeadToken[];
  /** Present iff the statement opened a `{ ... }` block. */
  block?: StatementNode[];
  loc: SrcLoc;
}

export type HeadToken =
  | { kind: 'ident'; value: string; loc: SrcLoc }
  | { kind: 'string'; value: string; loc: SrcLoc }
  | { kind: 'number'; value: number; loc: SrcLoc }
  | { kind: 'range'; start: number; end: number; loc: SrcLoc }
  | { kind: 'reference'; refType: string; identity: string; quoted: boolean; loc: SrcLoc }
  | { kind: 'list'; items: ListItem[]; loc: SrcLoc }
  | { kind: 'op'; value: ':' | '=' | '|' | '->' | '>=' | '<=' | '==' | '!=' | '>' | '<'; loc: SrcLoc };

export type ListItem = HeadToken;

/** A reference back to the head token's source range — useful for diagnostics. */
export function locOf(t: HeadToken): SrcLoc {
  return t.loc;
}
