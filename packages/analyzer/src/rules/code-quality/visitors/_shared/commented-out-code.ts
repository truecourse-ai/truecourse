/**
 * Shared line-oriented heuristic for the `commented-out-code` rule across C#,
 * JS/TS and Python.
 *
 * The earlier design scored four loose regexes over the *whole* comment text and
 * fired at a total of two matches. That misclassifies multi-line **instructional
 * prose** (e.g. a "This file is a placeholder … follow the pattern" block that
 * happens to include one example code line) as commented-out code, because a
 * single code-ish fragment plus one incidental `;`/`:` clears the threshold.
 *
 * Instead we classify each content line as `code`, `prose`, or `other`, and only
 * report a comment when its code lines are an outright majority of its
 * classified lines. A lone `// var x = Build(rows);` still fires (1 code line, 0
 * prose); a prose block with one embedded example does not (prose lines dominate).
 */

import type { Node as SyntaxNode } from 'web-tree-sitter'

export interface CommentedOutCodeOptions {
  /** True for Python-style (`#`) comments, where a trailing `:` terminates a line. */
  colonTerminates?: boolean
}

/** Strip a single line's residual comment markers (`//`, `#`, block-comment `*`). */
function stripLineMarker(line: string): string {
  return line
    .replace(/^\s*(?:\/\/+|#+)\s?/, '')
    .replace(/^\s*\*\/?\s?/, '')
    .replace(/\*\/\s*$/, '')
    .trim()
}

function looksLikeProse(line: string): boolean {
  const words = line.match(/[A-Za-z][A-Za-z'-]+/g) ?? []
  const codePunct = (line.match(/[;{}()=<>[\]]/g) ?? []).length
  // A run of ordinary words with almost no code punctuation reads as a sentence,
  // not a statement — even when it ends with `:` or `.`.
  if (words.length >= 4 && codePunct <= 1) return true
  // A natural-language sentence that merely *quotes* a code fragment: it opens
  // with a capitalized word followed by a lowercase word (e.g. "See foo.bar();",
  // "Call abp.notify.success(text);", "Returns the width of getSize();"). A real
  // statement starts with a keyword/identifier construct — `return …`, `const …`,
  // `Foo.bar(…)` — never a `Capitalized lowercase` word pair. This keeps prose
  // that embeds an example call from being scored as commented-out code.
  if (words.length >= 4 && /^[A-Z][a-z]+\s+[a-z]/.test(line)) return true
  return false
}

/**
 * A line is code only on *structural* evidence, not on merely containing code-ish
 * words. Prose that mentions identifiers ("the missing ConfigureAwait(false)", "a
 * string buffer, …") has no statement terminator and does not read as a whole
 * statement, so it is not counted — that is what kept the earlier heuristic noisy.
 */
function looksLikeCode(line: string, opts: CommentedOutCodeOptions): boolean {
  // Ends with a statement terminator or block delimiter.
  if (/[;{}]\s*$/.test(line)) return true
  // Python block header (`def …:`, `if …:`) — only where `:` terminates.
  if (opts.colonTerminates && /:\s*$/.test(line)) return true
  // Arrow function / lambda.
  if (/=>/.test(line)) return true
  // The whole line is a call expression (`foo.Bar(...)`), optionally terminated —
  // anchored so a trailing `Xyz(...)` inside a sentence does not qualify.
  if (/^[\w.]+\s*\([^)]*\)\s*;?\s*$/.test(line)) return true
  // The whole line is an assignment (`lhs = rhs`) — covers Python, which has no
  // `;`. Anchored to the line start so mid-sentence `=`/`(` do not match.
  if (/^[\w.[\]]+\s*=\s*[^=].*$/.test(line) && !/==/.test(line)) return true
  return false
}

/**
 * Decide whether a comment's inner text (delimiters already stripped by the
 * caller) is commented-out code rather than prose.
 */
export function isCommentedOutCode(inner: string, opts: CommentedOutCodeOptions): boolean {
  let code = 0
  let prose = 0
  for (const raw of inner.split('\n')) {
    const line = stripLineMarker(raw)
    if (line.length === 0) continue
    // Prose is checked first: a sentence that incidentally contains a keyword
    // word must not be counted as code.
    if (looksLikeProse(line)) prose++
    else if (looksLikeCode(line, opts)) code++
  }
  // Code must be present and at least as common as prose. `>=` (not `>`) tolerates
  // a single leading annotation line (`// TODO:`, a review marker) above one
  // genuine commented statement, while a prose-dominated instructional block —
  // several sentences around one example line — stays under the bar.
  return code > 0 && code >= prose
}

/**
 * Consecutive single-line comments (`// a` / `// b` / `# a`…) parse as separate
 * comment nodes, so a multi-line instructional block is only visible by walking
 * the contiguous run. Given a comment node, return the combined inner text of the
 * run it heads (delimiters stripped), or `null` when the node is not a line
 * comment or sits mid-run (a contiguous predecessor already heads it — evaluate
 * once, at the head). Block comments are not runs; the caller handles those.
 */
export function lineCommentRunInner(
  node: SyntaxNode,
  opts: { isLineComment: (text: string) => boolean; strip: (text: string) => string },
): string | null {
  const isRunLine = (n: SyntaxNode | null): n is SyntaxNode =>
    n != null && n.type === 'comment' && opts.isLineComment(n.text)
  if (!isRunLine(node)) return null
  // A contiguous line comment on the row above means we're mid-run.
  const prev = node.previousSibling
  if (isRunLine(prev) && prev.startPosition.row === node.startPosition.row - 1) return null

  const lines = [opts.strip(node.text)]
  let cur: SyntaxNode | null = node.nextSibling
  let lastRow = node.startPosition.row
  while (isRunLine(cur) && cur.startPosition.row === lastRow + 1) {
    lines.push(opts.strip(cur.text))
    lastRow = cur.startPosition.row
    cur = cur.nextSibling
  }
  return lines.join('\n')
}
