import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects syntax errors in forward (string) type annotations.
 * E.g., x: "Lit[int" (missing bracket), x: "Dict[str str]" (missing comma),
 * or x: "List[int,]" (trailing comma in non-tuple context).
 */
export const pythonForwardAnnotationSyntaxErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/forward-annotation-syntax-error',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    // Look for string type annotations
    const child = node.namedChildren[0]
    if (!child) return null
    if (child.type !== 'string') return null

    const text = child.text
    // Extract the annotation string content
    const match = text.match(/^['"]{1,3}(.*?)['"]{1,3}$/)
    if (!match) return null

    const annotation = match[1].trim()
    if (annotation.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Empty forward annotation',
        `Forward type annotation is an empty string — will cause a runtime error.`,
        sourceCode,
        'Provide a valid type annotation or remove the annotation.',
      )
    }

    // Check for unbalanced brackets
    let depth = 0
    for (const ch of annotation) {
      if (ch === '[') depth++
      if (ch === ']') depth--
      if (depth < 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Forward annotation syntax error',
          `Unbalanced brackets in forward annotation '${annotation}' — extra closing bracket.`,
          sourceCode,
          'Fix the bracket matching in the type annotation.',
        )
      }
    }
    if (depth > 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Forward annotation syntax error',
        `Unbalanced brackets in forward annotation '${annotation}' — missing closing bracket.`,
        sourceCode,
        'Add the missing closing bracket in the type annotation.',
      )
    }

    // Check for unbalanced parentheses
    depth = 0
    for (const ch of annotation) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (depth < 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Forward annotation syntax error',
          `Unbalanced parentheses in forward annotation '${annotation}'.`,
          sourceCode,
          'Fix the parentheses in the type annotation.',
        )
      }
    }
    if (depth > 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Forward annotation syntax error',
        `Unbalanced parentheses in forward annotation '${annotation}'.`,
        sourceCode,
        'Fix the parentheses in the type annotation.',
      )
    }

    // Check for obviously invalid characters
    if (/[{}@#$%^&*!~`]/.test(annotation.replace(/\{[^}]*\}/g, ''))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Forward annotation syntax error',
        `Invalid characters in forward annotation '${annotation}'.`,
        sourceCode,
        'Remove invalid characters from the type annotation.',
      )
    }

    return null
  },
}
