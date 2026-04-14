import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects invalid einops rearrange/reduce/repeat pattern strings.
 * Checks for basic syntax issues in the pattern argument.
 */
export const pythonEinopsPatternInvalidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/einops-pattern-invalid',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    // Match einops.rearrange, einops.reduce, einops.repeat, or direct imports
    if (!/^(einops\.)?(rearrange|reduce|repeat)$/.test(fnText)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // The pattern is the second argument (first is tensor)
    const patternArg = args.namedChildren[1]
    if (!patternArg || patternArg.type !== 'string') return null

    const pattern = patternArg.text.slice(1, -1) // strip quotes

    // Einops pattern: "left -> right" format
    if (!pattern.includes('->')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid einops pattern',
        `Einops pattern '${pattern}' is missing '->' separator — pattern must be in 'input -> output' format.`,
        sourceCode,
        'Add -> separator between input and output patterns.',
      )
    }

    const parts = pattern.split('->')
    if (parts.length !== 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid einops pattern',
        `Einops pattern has multiple '->' separators — only one is allowed.`,
        sourceCode,
        'Use exactly one -> separator in the pattern.',
      )
    }

    const [left, right] = parts.map((p) => p.trim())

    // Extract dimension names (ignoring parenthesized groups)
    const extractDims = (side: string): string[] => {
      return side
        .replace(/\(([^)]*)\)/g, ' $1 ')
        .split(/\s+/)
        .filter((d) => d.length > 0 && d !== '...' && d !== '1')
    }

    const leftDims = extractDims(left)
    const rightDims = extractDims(right)

    // Check for empty sides
    if (leftDims.length === 0 && left.trim() !== '') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid einops pattern',
        `Left side of einops pattern is malformed.`,
        sourceCode,
        'Fix the input pattern dimensions.',
      )
    }

    // Check for unbalanced parentheses
    for (const side of [left, right]) {
      const openCount = (side.match(/\(/g) || []).length
      const closeCount = (side.match(/\)/g) || []).length
      if (openCount !== closeCount) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Invalid einops pattern',
          `Unbalanced parentheses in einops pattern.`,
          sourceCode,
          'Ensure all parentheses are properly matched.',
        )
      }
    }

    // For rearrange: all dimensions on right must appear on left and vice versa (except '1')
    if (fnText.endsWith('rearrange')) {
      const leftSet = new Set(leftDims)
      const rightSet = new Set(rightDims)
      for (const d of rightDims) {
        if (!leftSet.has(d)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Invalid einops pattern',
            `Dimension '${d}' appears in output but not in input pattern.`,
            sourceCode,
            `Add '${d}' to the input pattern or remove it from the output.`,
          )
        }
      }
      for (const d of leftDims) {
        if (!rightSet.has(d)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Invalid einops pattern',
            `Dimension '${d}' appears in input but not in output pattern.`,
            sourceCode,
            `Add '${d}' to the output pattern or remove it from the input.`,
          )
        }
      }
    }

    return null
  },
}
