import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: re.compile(...) or re.match/search/findall with invalid regex pattern
// We validate the pattern string using JS RegExp (approximation)

const RE_FUNCTIONS = new Set(['compile', 'match', 'search', 'findall', 'finditer', 'sub', 'subn', 'split', 'fullmatch'])

function isReCall(fn: SyntaxNode): boolean {
  if (fn.type === 'attribute') {
    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    return obj?.text === 're' && attr !== null && RE_FUNCTIONS.has(attr.text ?? '')
  }
  return false
}

function extractStringContent(node: SyntaxNode): string | null {
  if (node.type !== 'string') return null
  let text = node.text
  // Remove raw string prefix r"..." -> "..."
  text = text.replace(/^[rRuUbBfF]*/, '')
  if (text.startsWith('"""') || text.startsWith("'''")) {
    return text.slice(3, -3)
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return text.slice(1, -1)
  }
  return null
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

export const pythonRegexInvalidPythonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-invalid-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || !isReCall(fn)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pattern = extractStringContent(firstArg)
    if (pattern === null) return null

    if (!isValidRegex(pattern)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'high',
        'Invalid regular expression',
        `The regular expression \`${firstArg.text}\` is syntactically invalid and will raise \`re.error\` at runtime.`,
        sourceCode,
        'Fix the regular expression syntax.',
      )
    }
    return null
  },
}
