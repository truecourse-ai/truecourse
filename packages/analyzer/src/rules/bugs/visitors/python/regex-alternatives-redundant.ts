import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects redundant alternatives in regex patterns.
 * E.g., r'a|ab' where 'a' makes 'ab' redundant (or vice versa).
 * Also catches r'foo|foo' (duplicate alternatives).
 */
export const pythonRegexAlternativesRedundantVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-alternatives-redundant',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Match re.compile(), re.search(), re.match(), re.fullmatch(), re.findall(), re.sub()
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    if (!/^re\.(compile|search|match|fullmatch|findall|sub|finditer|split)\b/.test(fnText)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Extract pattern from string literal
    const pattern = extractPattern(firstArg)
    if (!pattern) return null

    // Split on top-level | (not inside groups)
    const alternatives = splitTopLevelAlternatives(pattern)
    if (alternatives.length < 2) return null

    // Check for exact duplicates
    for (let i = 0; i < alternatives.length; i++) {
      for (let j = i + 1; j < alternatives.length; j++) {
        if (alternatives[i] === alternatives[j]) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Redundant regex alternative',
            `Duplicate alternative '${alternatives[i]}' in regex pattern.`,
            sourceCode,
            'Remove the duplicate alternative from the regex.',
          )
        }
      }
    }

    // Check for prefix/suffix subsumption (simple case: literal alternatives)
    for (let i = 0; i < alternatives.length; i++) {
      for (let j = 0; j < alternatives.length; j++) {
        if (i === j) continue
        const a = alternatives[i]
        const b = alternatives[j]
        // Only check simple literal alternatives (no special regex chars)
        if (/^[a-zA-Z0-9_]+$/.test(a) && /^[a-zA-Z0-9_]+$/.test(b)) {
          if (b.startsWith(a) && a !== b) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'Redundant regex alternative',
              `Alternative '${a}' makes '${b}' redundant — '${a}' will always match first.`,
              sourceCode,
              'Reorder alternatives (longer first) or remove the redundant one.',
            )
          }
        }
      }
    }

    return null
  },
}

function extractPattern(node: { type: string; text: string; namedChildren: any[] }): string | null {
  const text = node.text
  // r'...' or '...' or "..." or r"..."
  const match = text.match(/^[brBR]*['"]{1,3}(.*?)['"]{1,3}$/)
  if (match) return match[1]
  return null
}

function splitTopLevelAlternatives(pattern: string): string[] {
  const alternatives: string[] = []
  let depth = 0
  let current = ''
  let inCharClass = false

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      current += ch + (pattern[i + 1] || '')
      i++
      continue
    }
    if (ch === '[' && !inCharClass) {
      inCharClass = true
      current += ch
      continue
    }
    if (ch === ']' && inCharClass) {
      inCharClass = false
      current += ch
      continue
    }
    if (inCharClass) {
      current += ch
      continue
    }
    if (ch === '(') {
      depth++
      current += ch
      continue
    }
    if (ch === ')') {
      depth--
      current += ch
      continue
    }
    if (ch === '|' && depth === 0) {
      alternatives.push(current)
      current = ''
      continue
    }
    current += ch
  }
  alternatives.push(current)
  return alternatives
}
