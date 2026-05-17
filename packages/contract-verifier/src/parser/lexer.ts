/**
 * Hand-written lexer for the contract DSL.
 *
 * Tokens we recognize:
 *   - identifiers (kebab-case, dot-paths, plus uppercase artifact-type names)
 *   - quoted strings ("…" with backslash escapes)
 *   - numbers (positive integers; ranges `100..113` are two integers + a `..`)
 *   - punctuation: `{` `}` `[` `]` `(` `)` `,` `:` `=`
 *   - operators: `..`, `|`, `->`, `>=`, `<=`, `==`, `!=`, `>`, `<`
 *   - line comments `// …` and block comments `/* … *​/` — skipped
 *
 * We keep tokens "wide" — the parser disambiguates context (an identifier
 * may be a keyword, a primitive type name, or a free identifier).
 */

export type TokenKind =
  | 'ident'
  | 'reference'   // `Entity:Order`, `Operation:"POST /api/orders"`, …
  | 'string'
  | 'number'
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'colon'
  | 'equals'
  | 'dotdot'
  | 'pipe'
  | 'arrow'
  | 'gte'
  | 'lte'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'eof';

export interface ReferenceParts {
  type: string;
  identity: string;
  quoted: boolean;
}

/** Parse a `reference` token's `text` back into typed parts. */
export function parseReference(text: string): ReferenceParts {
  const colonIdx = text.indexOf(':');
  if (colonIdx < 0) throw new Error(`malformed reference token: ${text}`);
  const type = text.slice(0, colonIdx);
  let identity = text.slice(colonIdx + 1);
  let quoted = false;
  if (identity.startsWith('"') && identity.endsWith('"')) {
    quoted = true;
    identity = identity.slice(1, -1);
  }
  return { type, identity, quoted };
}

export interface Token {
  kind: TokenKind;
  text: string;
  line: number; // 1-indexed
  col: number;  // 1-indexed
}

export class LexError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${line}:${col} ${message}`);
  }
}

const SINGLE: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  '(': 'lparen',
  ')': 'rparen',
  ',': 'comma',
  ':': 'colon',
  '=': 'equals',
  '|': 'pipe',
};

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const startLine = (): number => line;
  const startCol = (): number => col;

  const advance = (): string => {
    const c = source[i++];
    if (c === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  };

  const peek = (offset = 0): string => source[i + offset] ?? '';

  while (i < source.length) {
    const c = peek();

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      advance();
      continue;
    }

    // Line comment
    if (c === '/' && peek(1) === '/') {
      while (i < source.length && peek() !== '\n') advance();
      continue;
    }

    // Block comment
    if (c === '/' && peek(1) === '*') {
      advance(); advance();
      while (i < source.length && !(peek() === '*' && peek(1) === '/')) advance();
      if (i < source.length) { advance(); advance(); }
      continue;
    }

    // Single-char punctuation
    if (SINGLE[c]) {
      const sl = startLine(), sc = startCol();
      advance();
      out.push({ kind: SINGLE[c], text: c, line: sl, col: sc });
      continue;
    }

    // Multi-char operators
    if (c === '.' && peek(1) === '.') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'dotdot', text: '..', line: sl, col: sc });
      continue;
    }
    if (c === '-' && peek(1) === '>') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'arrow', text: '->', line: sl, col: sc });
      continue;
    }
    if (c === '>' && peek(1) === '=') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'gte', text: '>=', line: sl, col: sc });
      continue;
    }
    if (c === '<' && peek(1) === '=') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'lte', text: '<=', line: sl, col: sc });
      continue;
    }
    if (c === '=' && peek(1) === '=') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'eq', text: '==', line: sl, col: sc });
      continue;
    }
    if (c === '!' && peek(1) === '=') {
      const sl = startLine(), sc = startCol();
      advance(); advance();
      out.push({ kind: 'neq', text: '!=', line: sl, col: sc });
      continue;
    }
    if (c === '>') {
      const sl = startLine(), sc = startCol();
      advance();
      out.push({ kind: 'gt', text: '>', line: sl, col: sc });
      continue;
    }
    if (c === '<') {
      const sl = startLine(), sc = startCol();
      advance();
      out.push({ kind: 'lt', text: '<', line: sl, col: sc });
      continue;
    }

    // Strings
    if (c === '"') {
      const sl = startLine(), sc = startCol();
      advance(); // opening quote
      let value = '';
      while (i < source.length && peek() !== '"') {
        const ch = peek();
        if (ch === '\\') {
          advance();
          const esc = peek();
          advance();
          switch (esc) {
            case 'n': value += '\n'; break;
            case 't': value += '\t'; break;
            case 'r': value += '\r'; break;
            case '"': value += '"'; break;
            case '\\': value += '\\'; break;
            default: value += esc;
          }
        } else {
          value += ch;
          advance();
        }
      }
      if (i >= source.length) {
        throw new LexError('unterminated string literal', sl, sc);
      }
      advance(); // closing quote
      out.push({ kind: 'string', text: value, line: sl, col: sc });
      continue;
    }

    // Numbers (positive integers; sign handled by parser if ever needed).
    //
    // Special case: `4xx` / `5xx` — HTTP status classes — read as a
    // single ident token. Their use is in lists like `[4xx, 5xx]`; the
    // `x` characters extend the digit run.
    if (c >= '0' && c <= '9') {
      const sl = startLine(), sc = startCol();
      let text = '';
      while (i < source.length && peek() >= '0' && peek() <= '9') {
        text += peek();
        advance();
      }
      if (peek() === 'x' && peek(1) === 'x') {
        text += 'xx';
        advance(); advance();
        // Treat as ident so list-of-idents parsers pick it up.
        out.push({ kind: 'ident', text, line: sl, col: sc });
        continue;
      }
      out.push({ kind: 'number', text, line: sl, col: sc });
      continue;
    }

    // Negative numbers in unenforceable origin (`-1..-1`).
    if (c === '-' && peek(1) >= '0' && peek(1) <= '9') {
      const sl = startLine(), sc = startCol();
      let text = '-';
      advance();
      while (i < source.length && peek() >= '0' && peek() <= '9') {
        text += peek();
        advance();
      }
      out.push({ kind: 'number', text, line: sl, col: sc });
      continue;
    }

    // Identifiers — kebab + dot + alphanumeric.
    //
    // Special case: a PascalCase identifier immediately followed by `:` is
    // a reference (`Entity:Order`, `Operation:"POST /api/orders"`). We
    // recognize it at lex time so the parser doesn't have to track context
    // — type-and-identity round-trip cleanly through one token.
    if (isIdentStart(c)) {
      const sl = startLine(), sc = startCol();
      let text = '';
      while (i < source.length && isIdentCont(peek())) {
        text += peek();
        advance();
      }
      // Reference detection: `<PascalCase>:` followed by an ident or string.
      if (
        text.length > 0 &&
        text[0] >= 'A' && text[0] <= 'Z' &&
        peek() === ':' &&
        (peek(1) === '"' || isIdentStart(peek(1)))
      ) {
        advance(); // consume `:`
        let refText = `${text}:`;
        if (peek() === '"') {
          refText += '"';
          advance();
          while (i < source.length && peek() !== '"') {
            refText += peek();
            advance();
          }
          if (i < source.length) {
            refText += '"';
            advance();
          } else {
            throw new LexError('unterminated string in reference', sl, sc);
          }
        } else {
          while (i < source.length && isIdentCont(peek())) {
            refText += peek();
            advance();
          }
        }
        out.push({ kind: 'reference', text: refText, line: sl, col: sc });
        continue;
      }
      out.push({ kind: 'ident', text, line: sl, col: sc });
      continue;
    }

    throw new LexError(`unexpected character '${c}'`, line, col);
  }

  out.push({ kind: 'eof', text: '', line, col });
  return out;
}

function isIdentStart(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isIdentCont(c: string): boolean {
  return isIdentStart(c) || (c >= '0' && c <= '9') || c === '-' || c === '.';
}
