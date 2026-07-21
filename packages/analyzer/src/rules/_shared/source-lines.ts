/**
 * Split source text into lines, memoizing the most recent result.
 *
 * Rule visitors fire once per matching AST node, and many of them need the
 * file's lines — to read the line above a statement, snippet a violation, scan
 * for a nearby pattern, etc. Calling `sourceCode.split('\n')` inside each
 * `visit()` re-scans the *entire* file on every node, so a file with N matching
 * nodes pays O(N × file-size). On a large (often generated) file that is
 * quadratic and looks exactly like a hang — the reason files fall into the
 * per-file timeout that PR #820 added (see that PR's review, item #3). The
 * timeout contains the damage; splitting once per file removes the reason the
 * damage happens at all.
 *
 * The analyzer walks one file to completion before starting the next, and every
 * `visit()`/`makeViolation()` call for a given file is handed the *same*
 * `sourceCode` string instance. Memoizing on that identity collapses a whole
 * file's worth of splits into a single O(file-size) split, with every later
 * call an O(1) cache hit. When the next file begins, its distinct source string
 * misses the cache and is split exactly once. The identity check makes the
 * cache correct regardless of call order: a miss only ever costs a re-split, it
 * can never return the wrong file's lines.
 *
 * The returned array is shared and cached — treat it as read-only. Callers only
 * ever index, slice, or iterate it; never mutate (push/splice/sort/assign) the
 * result, or later cache hits would observe the mutation.
 */
let cachedSource: string | undefined
let cachedLines: readonly string[] | undefined

export function splitLines(sourceCode: string): readonly string[] {
  if (sourceCode !== cachedSource || cachedLines === undefined) {
    cachedSource = sourceCode
    cachedLines = sourceCode.split('\n')
  }
  return cachedLines
}
