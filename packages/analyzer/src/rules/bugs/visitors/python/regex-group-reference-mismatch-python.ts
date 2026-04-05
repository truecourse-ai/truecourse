import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: re.sub(pattern, replacement) where replacement references non-existent group
// e.g. re.sub(r"(a)", r"\2", text) where pattern only has 1 group

function countGroups(pattern: string): number {
  let count = 0
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue }
    if (pattern[i] === '(' && pattern[i + 1] !== '?') count++
    if (pattern[i] === '(' && pattern[i + 1] === '?' && pattern[i + 2] === 'P' && pattern[i + 3] === '<') count++
  }
  return count
}

function findInvalidReplacementRef(replacement: string, groupCount: string[]): number | null {
  const re = /\\(\d+)/g
  let m: RegExpExecArray | null
  const count = parseInt(groupCount[0] ?? '0', 10)
  while ((m = re.exec(replacement)) !== null) {
    const ref = parseInt(m[1], 10)
    if (ref > count) return ref
  }
  return null
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  text = text.replace(/^[rRuUbBfF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) return text.slice(3, -3)
  if (text.startsWith('"') || text.startsWith("'")) return text.slice(1, -1)
  return null
}

export const pythonRegexGroupReferenceMismatchPythonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-group-reference-mismatch-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null
    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 're' || (attr?.text !== 'sub' && attr?.text !== 'subn')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const namedArgs = args.namedChildren.filter(c => c.type !== 'comment')
    if (namedArgs.length < 2) return null

    const patternArg = namedArgs[0]
    const replacementArg = namedArgs[1]

    const pattern = extractStringContent(patternArg)
    const replacement = extractStringContent(replacementArg)
    if (pattern === null || replacement === null) return null

    let groupCount = 0
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '\\') { i++; continue }
      if (pattern[i] === '(' && pattern[i + 1] !== '?') groupCount++
    }

    const re = /\\(\d+)/g
    let m: RegExpExecArray | null
    let invalidRef: number | null = null
    while ((m = re.exec(replacement)) !== null) {
      const ref = parseInt(m[1], 10)
      if (ref > groupCount) { invalidRef = ref; break }
    }

    if (invalidRef !== null) {
      return makeViolation(
        this.ruleKey, replacementArg, filePath, 'high',
        'Regex group replacement mismatch',
        `Replacement string references group \`\\${invalidRef}\` but the pattern only has ${groupCount} group${groupCount !== 1 ? 's' : ''} — will raise \`re.error\` at runtime.`,
        sourceCode,
        'Correct the group reference in the replacement string.',
      )
    }
    return null
  },
}
