/**
 * Closed keyword sets derived from the ohm `.tc` grammar source.
 *
 * The grammar (`grammar.ts`) is the single source of truth for which keywords
 * each clause admits. Several rules offer a CLOSED choice between two or more
 * leading `kw<"…">` keywords (channel sets, field/header modifiers, predicate
 * verbs, enum-body clauses, …). This module extracts those sets straight from
 * the grammar text so a downstream reference (e.g. an extraction prompt) can
 * never drift from the real grammar: adding or removing a keyword in
 * `grammar.ts` changes the derived output with no edits here.
 *
 * Rule selection is mechanical — a rule is included iff it exposes two or more
 * DISTINCT leading keywords across its alternatives. There is no hand-curated
 * list of rules.
 */
import { TC_GRAMMAR_SOURCE } from './grammar.js';

/** One alternative of a closed-keyword rule. */
export interface KeywordAlternative {
  /**
   * Leading keyword(s) of the alternative. Empty for an alternative that does
   * not begin with a keyword (a bare value/reference form kept for context).
   * More than one when the alternative begins with a parenthesized group of
   * keywords sharing the same argument shape (e.g. `(eq | neq | …) col value`).
   */
  keywords: string[];
  /** Simplified rendering of the tokens after the leading keyword(s). */
  argShape: string;
}

/** A grammar rule that offers a closed choice between leading keywords. */
export interface ClosedKeywordSet {
  /** Grammar rule name. */
  rule: string;
  /** Every legal leading keyword, in grammar order, de-duplicated. */
  keywords: string[];
  /** Per-alternative shape, in grammar order. */
  alternatives: KeywordAlternative[];
}

interface RawRule {
  name: string;
  body: string;
}

const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

// Brace-free sentinels used only while rendering: BLOCK stands in for a
// collapsed nested block; MARK brackets a keyword literal so it survives
// placeholder mapping. Both are control chars that never occur in grammar text.
const BLOCK = String.fromCharCode(1);
const MARK = String.fromCharCode(2);

/**
 * Remove ohm block/line comments while preserving string terminals verbatim
 * (so a quoted `"//"` or `"/*"` inside a lexical rule is NOT mistaken for a
 * comment, and a quoted `"|"` / `"="` is not mistaken for grammar punctuation).
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        const d = src[i];
        out += d;
        i++;
        if (d === '\\') {
          if (i < n) {
            out += src[i];
            i++;
          }
        } else if (d === '"') {
          break;
        }
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Split a comment-free grammar into `name = body` rules. Every unquoted `=` is
 * a rule-definition operator (all comparison/assignment tokens in the grammar
 * are quoted string terminals), so rule boundaries are found by scanning for
 * those, then reading the rule name backward from each.
 */
function splitRules(src: string): RawRule[] {
  const heads: { name: string; nameStart: number; eq: number }[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < n) {
        const d = src[i++];
        if (d === '\\') i++;
        else if (d === '"') break;
      }
      continue;
    }
    if (c === '=') {
      let j = i - 1;
      while (j >= 0 && isWs(src[j])) j--;
      if (src[j] === '+' || src[j] === ':') {
        // `+=` / `:=` rule extension/override.
        j--;
        while (j >= 0 && isWs(src[j])) j--;
      }
      if (src[j] === '>') {
        // Skip a `<param>` group between the name and `=` (e.g. `kw<k> =`).
        let depth = 1;
        j--;
        while (j >= 0 && depth > 0) {
          if (src[j] === '>') depth++;
          else if (src[j] === '<') depth--;
          j--;
        }
        while (j >= 0 && isWs(src[j])) j--;
      }
      const end = j + 1;
      while (j >= 0 && isIdentChar(src[j])) j--;
      const name = src.slice(j + 1, end);
      if (name) heads.push({ name, nameStart: j + 1, eq: i });
    }
    i++;
  }

  const rules: RawRule[] = [];
  for (let k = 0; k < heads.length; k++) {
    const bodyStart = heads[k].eq + 1;
    const bodyEnd = k + 1 < heads.length ? heads[k + 1].nameStart : src.length;
    let body = src.slice(bodyStart, bodyEnd);
    // Drop the grammar's closing brace (and trailing whitespace) off the last rule.
    body = body.replace(/\s*\}\s*$/, '');
    rules.push({ name: heads[k].name, body: body.trim() });
  }
  return rules;
}

/** Split a rule body into its top-level `|` alternatives (depth- and string-aware). */
function splitAlternatives(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i];
    if (c === '"') {
      cur += c;
      i++;
      while (i < n) {
        const d = body[i];
        cur += d;
        i++;
        if (d === '\\') {
          if (i < n) {
            cur += body[i];
            i++;
          }
        } else if (d === '"') {
          break;
        }
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '<') {
      depth++;
      cur += c;
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '>') {
      depth--;
      cur += c;
      i++;
      continue;
    }
    if (c === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(/\s*--\s*[A-Za-z0-9_]+\s*$/, '').trim()).filter(Boolean);
}

const KW_LEAD = /^kw<"([^"]+)">/;
const KW_GROUP_LEAD = /^\(\s*((?:kw<"[^"]+">\s*\|?\s*)+)\)/;

/** Leaf grammar tokens rendered as friendly placeholders. */
const LEAF_PLACEHOLDERS: Record<string, string> = {
  reference: '<ref>',
  refQuoted: '<ref>',
  string: '<string>',
  number: '<number>',
  ident: '<ident>',
  List: '<list>',
  column: '<column>',
  range: '<range>',
  statusClass: '<status-class>',
  Method: '<method>',
};

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Render the argument tokens of an alternative into a compact shape. Keyword
 * literals are preserved verbatim; string terminals collapse to their inner
 * text; leaf tokens become placeholders; operator-only rules expand to their
 * operator set; any nested block collapses to `{ … }`.
 */
function renderArgShape(rest: string, operatorRules: Map<string, string>): string {
  const kwLiterals: string[] = [];
  let s = rest.replace(/kw<"([^"]+)">/g, (_m, k: string) => {
    kwLiterals.push(k);
    return `${MARK}${kwLiterals.length - 1}${MARK}`;
  });
  s = s.replace(/"((?:\\.|[^"\\])*)"/g, (_m, inner: string) => inner.replace(/\\(.)/g, '$1'));
  s = s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => {
    if (operatorRules.has(word)) return operatorRules.get(word)!;
    if (Object.prototype.hasOwnProperty.call(LEAF_PLACEHOLDERS, word)) return LEAF_PLACEHOLDERS[word];
    if (/^[A-Z]/.test(word)) return `<${kebab(word)}>`;
    return word;
  });
  s = s.replace(/[*+?~]/g, ' ');
  // Collapse blocks (nested included) bottom-up: replace innermost brace pairs
  // with the brace-free BLOCK sentinel until none remain, then render `{ … }`.
  while (/\{[^{}]*\}/.test(s)) s = s.replace(/\{[^{}]*\}/g, BLOCK);
  s = s.split(BLOCK).join('{ … }');
  s = s.replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_m, idx: string) => kwLiterals[Number(idx)]);
  return s.replace(/\s+/g, ' ').trim();
}

/** True when every alternative is a bare string terminal (an operator set like `>= | <= | ==`). */
function operatorExpansion(alts: string[]): string | null {
  const ops: string[] = [];
  for (const alt of alts) {
    const m = alt.match(/^"((?:\\.|[^"\\])*)"$/);
    if (!m) return null;
    ops.push(m[1].replace(/\\(.)/g, '$1'));
  }
  return ops.length > 0 ? ops.join('|') : null;
}

/**
 * Derive every closed keyword set from a `.tc` grammar source. Pure and
 * deterministic: the returned sets follow grammar order and depend only on the
 * input string.
 */
export function deriveClosedKeywordSets(grammarSource: string): ClosedKeywordSet[] {
  const rules = splitRules(stripComments(grammarSource));

  // Operator-only rules (pure string-terminal alternations) are expanded inline
  // where they appear as an argument, never listed as keyword sets of their own.
  const operatorRules = new Map<string, string>();
  for (const r of rules) {
    const exp = operatorExpansion(splitAlternatives(r.body));
    if (exp) operatorRules.set(r.name, exp);
  }

  const sets: ClosedKeywordSet[] = [];
  for (const r of rules) {
    const alts = splitAlternatives(r.body);
    const alternatives: KeywordAlternative[] = [];
    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const alt of alts) {
      let keys: string[] = [];
      let rest = alt;
      const single = alt.match(KW_LEAD);
      const group = alt.match(KW_GROUP_LEAD);
      if (single) {
        keys = [single[1]];
        rest = alt.slice(single[0].length);
      } else if (group) {
        keys = [...group[1].matchAll(/kw<"([^"]+)">/g)].map((m) => m[1]);
        rest = alt.slice(group[0].length);
      }
      for (const k of keys) {
        if (!seen.has(k)) {
          seen.add(k);
          keywords.push(k);
        }
      }
      alternatives.push({ keywords: keys, argShape: renderArgShape(rest, operatorRules) });
    }

    if (seen.size >= 2) sets.push({ rule: r.name, keywords, alternatives });
  }
  return sets;
}

/** Render one closed keyword set as a single compact line. */
function renderSet(set: ClosedKeywordSet): string {
  const forms = set.alternatives.map((a) => {
    const kw = a.keywords.join('|');
    if (a.keywords.length === 0) return a.argShape;
    return a.argShape ? `${kw} ${a.argShape}` : kw;
  });
  return `${set.rule}: ${forms.join(' | ')}`;
}

/**
 * Render the closed keyword sets as a block of one line per rule (grammar
 * order). Each line names a grammar rule and its exhaustive set of legal
 * leading keywords with simplified argument shapes.
 */
export function renderClosedKeywordSets(sets: ClosedKeywordSet[]): string {
  return sets.map(renderSet).join('\n');
}

/**
 * Render the closed keyword sets of a `.tc` grammar (the live grammar by
 * default) as a reference block — one line per rule.
 */
export function renderGrammarKeywordReference(grammarSource: string = TC_GRAMMAR_SOURCE): string {
  return renderClosedKeywordSets(deriveClosedKeywordSets(grammarSource));
}
