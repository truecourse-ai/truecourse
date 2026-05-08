import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Strong code-shape patterns. Each implies the comment is code on its own,
// because real prose almost never uses these forms.
//
// `pass` / `continue` / `break` and bare `:` at end were tried but they're
// far too common in prose ("continue to flow", "varies by provider:",
// "circular dependency:"). Removed.
const STRONG_CODE_PATTERNS: RegExp[] = [
  // Comment starts with a Python statement-introducing keyword that is
  // almost never a sentence-starter in English documentation prose.
  /^\s*(?:def|class|async\s+def|from|import|return|raise|yield|del|global|nonlocal)\b/,
  // Control-flow header line ending in a colon: `if x:`, `for i in …:`,
  // `def foo(x):`, `try:`, `except FooError as e:`. The `:\s*$` alone is
  // too prose-like; pair it with a code keyword at the start.
  /^\s*(?:if|elif|else|for|while|try|except|finally|with|case|match)\b[^#]*:\s*$/,
  // Whole-line standalone function call: `foo(...)` / `obj.method(...)` /
  // `await foo(...)` with the line ending in `)` and no trailing prose.
  /^\s*(?:await\s+)?[\w.]+\([^)]*\)\s*$/,
  // Whole-line assignment: `x = …`, `obj.attr = …`, `self.x = …`.
  // The identifier on the LHS may include dots and subscripts.
  /^\s*[\w.[\]'"]+\s*[+\-*/%@&|^]?=\s*\S/,
]

// Weak patterns — they appear in prose too. Need at least two of these to
// fire, AND none of the prose-noise indicators below.
const WEAK_CODE_PATTERNS: RegExp[] = [
  // Mid-line keyword: `if`, `elif`, `for`, `while`, `try`, `except`, `with`.
  /\b(?:elif|except)\b/,
  // Function-call shape with parens.
  /\w+\([^)]*\)/,
  // Inline assignment / comparison with operator.
  /[\w\]]\s*[+\-*/%]?=[=!]?\s*\w/,
]

// Words that almost never appear in commented-out code but are common in
// prose. If the comment carries any of these and the only signal is the
// weak set, treat it as prose.
const PROSE_INDICATORS: RegExp[] = [
  /\b(?:the|this|that|these|those|when|whether|because|since|currently|already|still|only|just|note|todo|fixme|hack|workaround)\b/i,
]

export const pythonCommentedOutCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/commented-out-code',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    if (!text.startsWith('#')) return null

    const inner = text.slice(1).trim()
    if (inner.length < 10) return null

    // Strip simple inline comment markers like `# noqa: ...` or `# type: ...`
    if (/^(?:noqa|type|fmt|pyright|pylint|flake8|mypy):/i.test(inner)) return null

    // Value-legend comments: `# False = not migrated, True = migrated`,
    // `# None = undecided`, `# 0 = pending, 1 = active`. The LHS is a
    // Python literal (True/False/None/integer), the RHS is prose. This
    // is a docstring-style explanation, not an assignment.
    if (/^\s*(?:True|False|None|\d+)\s*=\s*[A-Za-z]/.test(inner)) return null

    // Prose illustration markers: "for example", "given", "yields",
    // "such as", "e.g." — natural-language documentation that may
    // contain code-like fragments coincidentally.
    if (/\b(?:for example|given (?:a|an|the)|yields|such as|e\.g\.|i\.e\.)\b/i.test(inner)) return null

    // A single strong signal is enough — those forms are highly
    // unambiguous code.
    if (STRONG_CODE_PATTERNS.some((p) => p.test(inner))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Commented-out code',
        'This comment appears to contain commented-out code. Remove it or track it in version control.',
        sourceCode,
        'Delete the commented-out code. If needed, it can be recovered from version control.',
      )
    }

    // Prose with embedded code fragments (operators, parenthetical asides)
    // would otherwise hit two weak patterns. If any prose indicator is
    // present, treat the comment as natural-language documentation.
    if (PROSE_INDICATORS.some((p) => p.test(inner))) return null

    const weakMatches = WEAK_CODE_PATTERNS.filter((p) => p.test(inner)).length
    if (weakMatches >= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Commented-out code',
        'This comment appears to contain commented-out code. Remove it or track it in version control.',
        sourceCode,
        'Delete the commented-out code. If needed, it can be recovered from version control.',
      )
    }
    return null
  },
}
