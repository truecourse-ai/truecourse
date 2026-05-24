import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

const MAX_REGEX_LENGTH = 50
const MAX_GROUPS = 5

function maxParenDepth(pattern: string): number {
  let depth = 0
  let max = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; continue }
    if (c === '[') {
      // Skip character class body
      i++
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '(') {
      depth++
      if (depth > max) max = depth
    } else if (c === ')') {
      depth--
    }
  }
  return max
}

function isTopLevelNamedConstInitializer(regexNode: SyntaxNode): boolean {
  const declarator = regexNode.parent
  if (!declarator || declarator.type !== 'variable_declarator') return false
  const decl = declarator.parent
  if (!decl || decl.type !== 'lexical_declaration') return false
  const declParent = decl.parent
  if (!declParent) return false
  if (declParent.type === 'program') return true
  if (declParent.type === 'export_statement' && declParent.parent?.type === 'program') return true
  return false
}

export const regexComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    // Skip build/runtime config files (vite.config.ts, vitest.config.ts,
    // webpack.config.js, etc.) — regexes there typically match well-known
    // build-tool conventions (query params, virtual-module specifiers,
    // bundler internals) and are config, not application logic.
    const lowerPath = filePath.toLowerCase()
    if (/\.config\.[cm]?[jt]sx?$/.test(lowerPath)) return null

    const patternNode = node.namedChildren.find((c) => c.type === 'regex_pattern')
    if (!patternNode) return null

    const pattern = patternNode.text

    // Skip well-known regex patterns (UUID, email, ISO date, semver)
    const wellKnownPatterns = [
      /\[0-9a-f\]\{8\}-?\[0-9a-f\]\{4\}/i,            // UUID
      /\[a-zA-Z0-9.*\].*@.*\[a-zA-Z0-9\]/,             // Email
      /\\d\{4\}[-/]\\d\{2\}[-/]\\d\{2\}/,              // ISO date
      /\\d+\\.\\d+\\.\\d+/,                              // Semver
    ]
    if (wellKnownPatterns.some((wp) => wp.test(pattern))) return null

    // Compute structural signals once.
    const hasLookahead = pattern.includes('(?=') || pattern.includes('(?!') || pattern.includes('(?<=') || pattern.includes('(?<!')
    const hasBackref = /(?<!\\)\\[1-9]/.test(pattern)
    const groupCount = (pattern.match(/\(/g) || []).length
    const maxDepth = maxParenDepth(pattern)

    // Skip when the regex is already pulled out into a top-level named
    // `const` (or `export const`). The name documents intent — exactly
    // what the rule asks for — so long-but-moderately-structured
    // validators (path-prefix lists, email/domain grammars) at module
    // scope are not FPs. The skip is gated on moderate group count and
    // no backreferences, so deeply-grouped or self-referencing patterns
    // still fire even when named.
    if (
      isTopLevelNamedConstInitializer(node)
      && groupCount < MAX_GROUPS
      && !hasBackref
    ) return null

    // Skip structurally simple patterns: a flat alternation of literal
    // chunks (paren depth ≤ 1, no lookaheads, no backreferences, fewer
    // than MAX_GROUPS) is easy to read regardless of total length —
    // typical of user-agent OR-lists, file-extension matchers, and
    // similar enumerations.
    if (!hasLookahead && !hasBackref && maxDepth <= 1 && groupCount < MAX_GROUPS) return null

    if (pattern.length < MAX_REGEX_LENGTH) {
      if (groupCount < MAX_GROUPS) return null
    }

    const isComplex = pattern.length >= MAX_REGEX_LENGTH || groupCount >= MAX_GROUPS || hasLookahead

    if (!isComplex) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Complex regular expression',
      `Regular expression is complex (length: ${pattern.length}, groups: ${groupCount}) — extract to a named constant with a comment explaining it.`,
      sourceCode,
      'Extract the regex to a named constant: `const MY_PATTERN = /regex/;` with a comment explaining its purpose.',
    )
  },
}
