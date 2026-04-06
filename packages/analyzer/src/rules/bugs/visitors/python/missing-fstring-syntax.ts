import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: "Hello {name}" without f prefix — looks like f-string but isn't
// Heuristic: string contains {identifier} pattern (not a format spec)

const LOOKS_LIKE_FSTRING = /\{[a-zA-Z_][a-zA-Z0-9_.]*\}/

function isFstring(node: SyntaxNode): boolean {
  return /^[fF]/.test(node.text) || /^[rR][fF]/.test(node.text) || /^[fF][rR]/.test(node.text)
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  // Remove prefix
  text = text.replace(/^[rubfRUBF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) return text.slice(3, -3)
  if (text.startsWith('"') || text.startsWith("'")) return text.slice(1, -1)
  return null
}

export const pythonMissingFstringSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-fstring-syntax',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    if (isFstring(node)) return null

    const content = extractStringContent(node)
    if (content === null) return null

    if (LOOKS_LIKE_FSTRING.test(content)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'String looks like f-string but missing f prefix',
        `The string \`${node.text.slice(0, 40)}\` contains \`{variable}\` syntax but is not an f-string — the variable will not be interpolated. Did you forget the \`f\` prefix?`,
        sourceCode,
        `Add the \`f\` prefix: \`f${node.text}\`.`,
      )
    }
    return null
  },
}
