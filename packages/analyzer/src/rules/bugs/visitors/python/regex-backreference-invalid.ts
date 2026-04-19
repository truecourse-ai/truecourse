import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: regex backreference to a group that doesn't exist
// e.g. r"(a)\2" when there's only 1 group

function countGroups(pattern: string): number {
  // Count non-escaped, non-non-capturing groups
  let count = 0
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue }
    if (pattern[i] === '(' && pattern[i + 1] !== '?') count++
    if (pattern[i] === '(' && pattern[i + 1] === '?' && pattern[i + 2] === 'P' && pattern[i + 3] === '<') count++
    if (pattern[i] === '(' && pattern[i + 1] === '?' && pattern[i + 2] === ':') continue // non-capturing
  }
  return count
}

function findInvalidBackref(pattern: string, groupCount: number): number | null {
  const re = /\\(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pattern)) !== null) {
    const ref = parseInt(m[1], 10)
    if (ref > groupCount) return ref
  }
  return null
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

export const pythonRegexBackreferenceInvalidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-backreference-invalid',
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

    const groupCount = countGroups(pattern)
    const invalidRef = findInvalidBackref(pattern, groupCount)

    if (invalidRef !== null) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Invalid regex backreference',
        `Backreference \`\\${invalidRef}\` refers to a group that doesn't exist (only ${groupCount} group${groupCount !== 1 ? 's' : ''} defined) — will raise \`re.error\` at runtime.`,
        sourceCode,
        `Check the group numbering in the pattern and correct the backreference.`,
      )
    }
    return null
  },
}
