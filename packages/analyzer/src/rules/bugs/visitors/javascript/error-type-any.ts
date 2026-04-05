import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects catch blocks that type the error as `any` or `unknown` without
 * narrowing before property access.
 * Pattern: catch (e: any) { e.message } or catch (e: unknown) { e.message }
 */
export const errorTypeAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/error-type-any',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // TypeScript catch clause: catch (e: any) or catch (e: unknown)
    // In TypeScript's AST: catch ( identifier type_annotation ) body
    // The type_annotation is a sibling of the identifier, not a child
    const parameter = node.childForFieldName('parameter')
    if (!parameter) return null

    // Look for type annotation as a sibling of the parameter in the catch clause
    let typeAnnotation: import('tree-sitter').SyntaxNode | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === 'type_annotation') {
        typeAnnotation = child
        break
      }
    }
    if (!typeAnnotation) return null

    // Get the type text
    const typeNode = typeAnnotation.namedChildren[0]
    if (!typeNode) return null
    const typeName = typeNode.text

    if (typeName !== 'any' && typeName !== 'unknown') return null

    // Check if the body accesses properties on the error without narrowing
    const body = node.childForFieldName('body')
    if (!body) return null

    const paramName = parameter.type === 'identifier' ? parameter.text :
      parameter.namedChildren[0]?.text ?? ''

    if (!paramName) return null

    // Look for direct property access on the error variable without a type check
    let hasPropertyAccess = false
    let hasTypeCheck = false

    function scanBody(n: import('tree-sitter').SyntaxNode): void {
      if (
        n.type === 'member_expression' &&
        n.childForFieldName('object')?.text === paramName
      ) {
        hasPropertyAccess = true
      }
      // instanceof check: if (e instanceof Error)
      if (
        n.type === 'binary_expression' &&
        n.children.find((c) => c.text === 'instanceof') &&
        n.childForFieldName('left')?.text === paramName
      ) {
        hasTypeCheck = true
      }
      // typeof check
      if (
        n.type === 'unary_expression' &&
        n.children.find((c) => c.text === 'typeof') &&
        n.namedChildren[0]?.text === paramName
      ) {
        hasTypeCheck = true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) scanBody(child)
      }
    }

    scanBody(body)

    if (hasPropertyAccess && !hasTypeCheck) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Error caught as any/unknown without narrowing',
        `\`${paramName}\` is typed as \`${typeName}\` but properties are accessed without type narrowing — this can cause a runtime error if the caught value is not an Error object.`,
        sourceCode,
        `Add a type check: \`if (${paramName} instanceof Error) { ... }\` before accessing \`${paramName}.message\` or other properties.`,
      )
    }

    return null
  },
}
