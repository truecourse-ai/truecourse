import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: re patterns with empty alternatives like (a|) or (|b) or a|

function hasEmptyAlternative(pattern: string): boolean {
  // Check for || or (| or |) patterns (empty branch in alternation)
  return /\|\|/.test(pattern) || /\(\s*\|/.test(pattern) || /\|\s*\)/.test(pattern) || /^\|/.test(pattern) || /\|$/.test(pattern)
}

function isReCall(node: SyntaxNode): boolean {
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return false
  const obj = fn.childForFieldName('object')
  return obj?.text === 're'
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  text = text.replace(/^[rRuUbBfF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) return text.slice(3, -3)
  if (text.startsWith('"') || text.startsWith("'")) return text.slice(1, -1)
  return null
}

export const pythonRegexEmptyAlternativePythonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-empty-alternative-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    if (!isReCall(node)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pattern = extractStringContent(firstArg)
    if (pattern === null) return null

    if (hasEmptyAlternative(pattern)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'medium',
        'Empty regex alternative',
        `The regular expression contains an empty alternative (e.g. \`a|\` or \`|b\`) — one branch always matches the empty string, making the alternation trivially true.`,
        sourceCode,
        'Remove the empty alternative or add the missing branch.',
      )
    }
    return null
  },
}
