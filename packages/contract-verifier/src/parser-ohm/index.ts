/**
 * ohm-js front-end for the TrueCourse `.tc` contract DSL.
 *
 * `parseAndResolve` parses every file with the strict per-kind ohm grammar
 * (`grammar.ts`), rebuilds the SAME generic statement tree the hand-written
 * parser produced (`FileNode` / `StatementNode` / `HeadToken`), and feeds it
 * through the EXISTING resolver and per-kind lifters unchanged. Because the
 * lifters are reused verbatim, the typed `contract` payloads are byte-identical
 * to the legacy pipeline — the only thing this module replaces is the front
 * door (lexer + generic parser), not the semantics.
 *
 * The collapse from the strict structured match back to the generic
 * `{ head, block?, loc }` shape is uniform: every clause is a flat run of head
 * tokens optionally containing a single `{ … }` block. One `parts` operation
 * flattens any node into an ordered list of head tokens and block markers
 * (detecting the `"{" Stmt* "}"` shape positionally so nested blocks recurse
 * into per-statement nodes); the statement builder splits that list into
 * `head` + `block`.
 */
import type { Node } from 'ohm-js';
import { tcGrammar } from './grammar.js';
import type {
  FileNode,
  HeadToken,
  ListItem,
  SrcLoc,
  StatementNode,
} from '../parser/index.js';
import { resolve, type ResolveResult } from '../resolver/index.js';

export type { ResolveResult };

// ---------------------------------------------------------------------------
// Source-offset → 1-indexed {line, col}
// ---------------------------------------------------------------------------

/** Precomputed line-start offsets for a single source string. */
class LineMap {
  private starts: number[] = [0];
  constructor(src: string) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\n') this.starts.push(i + 1);
    }
  }
  /** Convert a 0-based char offset to 1-indexed line/col. */
  locAt(offset: number, filePath: string): SrcLoc {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { filePath, line: lo + 1, col: offset - this.starts[lo] + 1 };
  }
}

// ---------------------------------------------------------------------------
// Parts: a node collapses to an ordered list of head tokens + block markers.
// ---------------------------------------------------------------------------

interface BlockPart {
  block: StatementNode[];
}
type Part = HeadToken | BlockPart;

function isBlock(p: Part): p is BlockPart {
  return (p as BlockPart).block !== undefined;
}

/** Decode the legacy lexer's string escapes (\n \t \r \" \\). */
function decodeString(raw: string): string {
  const inner = raw.slice(1, -1); // strip surrounding quotes
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\') {
      const esc = inner[++i];
      switch (esc) {
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case '"': out += '"'; break;
        case '\\': out += '\\'; break;
        default: out += esc;
      }
    } else {
      out += c;
    }
  }
  return out;
}

const OP_VALUES = new Set([':', '=', '|', '->', '>=', '<=', '==', '!=', '>', '<']);

type OpValue = Extract<HeadToken, { kind: 'op' }>['value'];

function parseOne(filePath: string, source: string): FileNode {
  const matchResult = tcGrammar.match(source);
  if (matchResult.failed()) {
    throw new Error(`${filePath}: ${matchResult.message}`);
  }

  const lineMap = new LineMap(source);
  const locOf = (node: Node): SrcLoc => lineMap.locAt(node.source.startIdx, filePath);
  const textOf = (node: Node): string => source.slice(node.source.startIdx, node.source.endIdx);

  const sem = tcGrammar.createSemantics();

  /** Split a flat parts list into a StatementNode (head tokens + opt block). */
  const toStmt = (parts: Part[], loc: SrcLoc): StatementNode => {
    const head: HeadToken[] = [];
    let block: StatementNode[] | undefined;
    for (const p of parts) {
      if (isBlock(p)) block = p.block;
      else head.push(p);
    }
    return block ? { head, block, loc } : { head, loc };
  };

  sem.addOperation<Part[]>('parts', {
    // ---- token leaves -----------------------------------------------------
    ident(start, cont, call) {
      // A bare ident is its source text. A call/precision ident (`NOW()`,
      // `numeric(4, 3)`) folds the `( … )` group into the value with all
      // interior whitespace stripped — reproducing how the old lexer
      // concatenated the inner token texts into one ident token.
      const word = textOf(start as Node) + textOf(cont as Node);
      const callNode = (call as Node).child(0);
      if (!callNode) return [{ kind: 'ident', value: word, loc: locOf(this) }];
      const callText = textOf(callNode).replace(/\s+/g, '');
      return [{ kind: 'ident', value: word + callText, loc: locOf(this) }];
    },
    reference(_u, _c, _colon, _tail) {
      const text = textOf(this);
      const colonIdx = text.indexOf(':');
      const type = text.slice(0, colonIdx);
      let identity = text.slice(colonIdx + 1);
      let quoted = false;
      if (identity.startsWith('"') && identity.endsWith('"')) {
        quoted = true;
        identity = identity.slice(1, -1);
      }
      return [{ kind: 'reference', refType: type, identity, quoted, loc: locOf(this) }];
    },
    string(_o, _cs, _c) {
      return [{ kind: 'string', value: decodeString(textOf(this)), loc: locOf(this) }];
    },
    statusClass(_d, _xx) {
      // `4xx` is an `ident` token in the legacy lexer.
      return [{ kind: 'ident', value: textOf(this), loc: locOf(this) }];
    },
    range(_a, _dd, _b) {
      const [s, e] = textOf(this).split('..');
      return [{ kind: 'range', start: parseInt(s, 10), end: parseInt(e, 10), loc: locOf(this) }];
    },
    number(_sign, _digits, _dot, _frac) {
      return [{ kind: 'number', value: parseFloat(textOf(this)), loc: locOf(this) }];
    },
    List(_open, items, _close) {
      const out: ListItem[] = [];
      for (const part of (items as Node).parts() as Part[]) {
        if (!isBlock(part)) out.push(part as ListItem);
      }
      return [{ kind: 'list', items: out, loc: locOf(this) }];
    },
    ListItem(item, _comma) {
      return (item as Node).parts() as Part[];
    },
    kw(_k) {
      // `kw<k>` matches the bare keyword text — an `ident` token generically.
      return [{ kind: 'ident', value: textOf(this), loc: locOf(this) }];
    },

    // ---- defaults ---------------------------------------------------------
    _terminal() {
      const s = textOf(this);
      if (OP_VALUES.has(s)) {
        return [{ kind: 'op', value: s as OpValue, loc: locOf(this) }];
      }
      // structural punctuation ({ } [ ] , ") contributes nothing on its own
      return [];
    },
    _nonterminal(...children: Node[]) {
      const out: Part[] = [];
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        // Detect the inline `"{" Stmt* "}"` block shape positionally: a
        // terminal `{` is always followed by the statement iteration, then `}`.
        if (c.ctorName === '_terminal' && textOf(c) === '{') {
          const iter = children[i + 1];
          const stmts: StatementNode[] = (iter.children as Node[]).map((ch) =>
            toStmt(ch.parts() as Part[], locOf(ch)),
          );
          out.push({ block: stmts });
          i += 2; // skip the iteration and the closing `}`
          continue;
        }
        out.push(...(c.parts() as Part[]));
      }
      return out;
    },
    _iter(...children: Node[]) {
      const out: Part[] = [];
      for (const c of children) out.push(...(c.parts() as Part[]));
      return out;
    },
  });

  // File = Artifact* — each Artifact is one top-level statement. Map the
  // Artifact iteration to per-statement nodes (NOT a flat flatten, which
  // would merge artifacts).
  sem.addOperation<StatementNode[]>('topLevel', {
    File(artifactIter: Node) {
      return (artifactIter.children as Node[]).map((art) =>
        toStmt(art.parts() as Part[], locOf(art)),
      );
    },
  });

  const statements = (sem(matchResult) as unknown as { topLevel(): StatementNode[] }).topLevel();
  return { filePath, statements };
}

export function parseAndResolve(files: { path: string; source: string }[]): ResolveResult {
  const parsed: FileNode[] = files.map((f) => parseOne(f.path, f.source));
  return resolve(parsed);
}

/**
 * Parse a single `.tc` file into the generic statement tree, throwing on a
 * grammar failure. Consumers that need per-file error isolation (e.g. the CLI
 * `contracts validate`/`list` commands, which scan user-authored directories
 * that may contain malformed files) parse each file in a try/catch and feed
 * the surviving `FileNode`s to the resolver.
 */
export function parseTcFile(path: string, source: string): FileNode {
  return parseOne(path, source);
}
