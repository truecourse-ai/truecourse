import { tokenize, parseReference, type Token, LexError } from './lexer.js';
import type { FileNode, HeadToken, StatementNode, SrcLoc, ListItem } from './ast.js';

export class ParseError extends Error {
  constructor(message: string, public filePath: string, public line: number, public col: number) {
    super(`${filePath}:${line}:${col} ${message}`);
  }
}

/**
 * Parse a `.tc` file source into a generic statement tree. Per-artifact
 * lifters take this tree and produce typed contracts.
 *
 * Statement boundaries:
 *   - A `{` immediately after the head opens a block; `}` closes it.
 *   - At brace-level 0, a newline (token on a higher line than the
 *     statement's first token) ends the current statement.
 *   - Inside `[ ... ]` lists, newlines don't break statements.
 */
export function parseFile(filePath: string, source: string): FileNode {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (e) {
    if (e instanceof LexError) {
      throw new ParseError(e.message, filePath, e.line, e.col);
    }
    throw e;
  }
  const ctx = new ParseContext(filePath, tokens);
  const statements = parseStatementsUntil(ctx, 'eof');
  return { filePath, statements };
}

class ParseContext {
  pos = 0;
  constructor(public filePath: string, public tokens: Token[]) {}

  peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1];
  }

  advance(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  loc(t: Token): SrcLoc {
    return { filePath: this.filePath, line: t.line, col: t.col };
  }

  err(message: string, t: Token = this.peek()): never {
    throw new ParseError(message, this.filePath, t.line, t.col);
  }
}

function parseStatementsUntil(ctx: ParseContext, terminator: 'rbrace' | 'eof'): StatementNode[] {
  const out: StatementNode[] = [];
  while (true) {
    const t = ctx.peek();
    if (t.kind === terminator) break;
    if (t.kind === 'eof' && terminator !== 'eof') {
      ctx.err(`unexpected end of file (looking for closing ${terminator})`);
    }
    out.push(parseStatement(ctx));
  }
  return out;
}

function parseStatement(ctx: ParseContext): StatementNode {
  const first = ctx.peek();
  const startLine = first.line;
  const head: HeadToken[] = [];

  while (true) {
    const t = ctx.peek();
    if (t.kind === 'eof') break;
    if (t.kind === 'lbrace' || t.kind === 'rbrace') break;
    // Newline guard: any token whose line is greater than this statement's
    // start ends the statement (we're at brace-depth 0 here; lists are
    // consumed eagerly by parseHeadToken so newlines inside lists don't
    // reach here).
    if (head.length > 0 && t.line > startLine) break;
    head.push(parseHeadToken(ctx));
  }

  if (head.length === 0) {
    ctx.err(`expected statement, got ${ctx.peek().kind}`);
  }

  let block: StatementNode[] | undefined;
  if (ctx.peek().kind === 'lbrace') {
    ctx.advance(); // consume `{`
    block = parseStatementsUntil(ctx, 'rbrace');
    if (ctx.peek().kind !== 'rbrace') {
      ctx.err('expected `}` to close block');
    }
    ctx.advance(); // consume `}`
  }

  return { head, block, loc: ctx.loc(first) };
}

function parseHeadToken(ctx: ParseContext): HeadToken {
  const t = ctx.peek();
  switch (t.kind) {
    case 'ident': {
      ctx.advance();
      // Type-precision notation like `numeric(4,3)` or `decimal(15,2)` —
      // consume the `(args)` group and fold it into the ident value.
      if (ctx.peek().kind === 'lparen') {
        let parenText = '(';
        ctx.advance(); // consume '('
        while (ctx.peek().kind !== 'rparen' && ctx.peek().kind !== 'eof') {
          parenText += ctx.peek().text;
          ctx.advance();
        }
        parenText += ')';
        if (ctx.peek().kind === 'rparen') ctx.advance();
        return { kind: 'ident', value: t.text + parenText, loc: ctx.loc(t) };
      }
      return { kind: 'ident', value: t.text, loc: ctx.loc(t) };
    }
    case 'string': {
      ctx.advance();
      return { kind: 'string', value: t.text, loc: ctx.loc(t) };
    }
    case 'number': {
      ctx.advance();
      // Maybe a range: `100..113` or `1..50`.
      if (ctx.peek().kind === 'dotdot' && ctx.peek(1).kind === 'number') {
        ctx.advance(); // ..
        const end = ctx.advance();
        return {
          kind: 'range',
          start: parseInt(t.text, 10),
          end: parseInt(end.text, 10),
          loc: ctx.loc(t),
        };
      }
      // Use parseFloat so decimal literals (`0.5`, `1.25`) survive the
      // parse. Integers (`42`) round-trip identically through parseFloat.
      return { kind: 'number', value: parseFloat(t.text), loc: ctx.loc(t) };
    }
    case 'reference': {
      ctx.advance();
      const parts = parseReference(t.text);
      return {
        kind: 'reference',
        refType: parts.type,
        identity: parts.identity,
        quoted: parts.quoted,
        loc: ctx.loc(t),
      };
    }
    case 'lbracket': {
      const open = ctx.advance();
      const items: ListItem[] = [];
      while (ctx.peek().kind !== 'rbracket' && ctx.peek().kind !== 'eof') {
        items.push(parseHeadToken(ctx));
        if (ctx.peek().kind === 'comma') {
          ctx.advance();
        }
      }
      if (ctx.peek().kind !== 'rbracket') {
        ctx.err('unterminated list — expected `]`');
      }
      ctx.advance(); // consume `]`
      return { kind: 'list', items, loc: ctx.loc(open) };
    }
    case 'colon':
      ctx.advance();
      return { kind: 'op', value: ':', loc: ctx.loc(t) };
    case 'equals':
      ctx.advance();
      return { kind: 'op', value: '=', loc: ctx.loc(t) };
    case 'pipe':
      ctx.advance();
      return { kind: 'op', value: '|', loc: ctx.loc(t) };
    case 'arrow':
      ctx.advance();
      return { kind: 'op', value: '->', loc: ctx.loc(t) };
    case 'gte':
      ctx.advance();
      return { kind: 'op', value: '>=', loc: ctx.loc(t) };
    case 'lte':
      ctx.advance();
      return { kind: 'op', value: '<=', loc: ctx.loc(t) };
    case 'eq':
      ctx.advance();
      return { kind: 'op', value: '==', loc: ctx.loc(t) };
    case 'neq':
      ctx.advance();
      return { kind: 'op', value: '!=', loc: ctx.loc(t) };
    case 'gt':
      ctx.advance();
      return { kind: 'op', value: '>', loc: ctx.loc(t) };
    case 'lt':
      ctx.advance();
      return { kind: 'op', value: '<', loc: ctx.loc(t) };
    default:
      ctx.err(`unexpected token in head: ${t.kind} '${t.text}'`);
  }
}
