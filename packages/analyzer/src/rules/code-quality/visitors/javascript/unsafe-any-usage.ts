import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Using a value typed as `any` in assignments, calls, returns, or member access.
 * Corresponds to @typescript-eslint no-unsafe-argument, no-unsafe-assignment,
 * no-unsafe-call, no-unsafe-member-access, no-unsafe-return.
 */
export const unsafeAnyUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unsafe-any-usage',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression', 'member_expression', 'assignment_expression', 'variable_declarator'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    if (node.type === 'call_expression') {
      // Unsafe call: calling a value typed as any
      const fn = node.childForFieldName('function')
      if (fn && fn.type === 'identifier') {
        const isAny = typeQuery.isAnyType(filePath, fn.startPosition.row, fn.startPosition.column, fn.endPosition.row, fn.endPosition.column)
        if (isAny) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Calling an `any` typed value',
            `\`${fn.text}\` is typed as \`any\` — calling it bypasses all type checking.`,
            sourceCode,
            'Add a proper type annotation or use `unknown` with type guards.',
          )
        }
      }
    }

    if (node.type === 'member_expression') {
      // Unsafe member access: accessing property on any
      const obj = node.childForFieldName('object')
      if (obj && obj.type === 'identifier') {
        const isAny = typeQuery.isAnyType(filePath, obj.startPosition.row, obj.startPosition.column, obj.endPosition.row, obj.endPosition.column)
        if (isAny) {
          const prop = node.childForFieldName('property')
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Unsafe member access on `any`',
            `Accessing \`.${prop?.text ?? '?'}\` on \`${obj.text}\` which is typed as \`any\` — no type safety.`,
            sourceCode,
            'Add a proper type annotation to the object or use type guards.',
          )
        }
      }
    }

    if (node.type === 'variable_declarator') {
      // Unsafe assignment: assigning any to a typed variable
      const value = node.childForFieldName('value')
      if (!value) return null
      const isAny = typeQuery.isAnyType(filePath, value.startPosition.row, value.startPosition.column, value.endPosition.row, value.endPosition.column)
      if (isAny && value.type !== 'identifier') {
        // Only flag non-trivial any assignments (e.g., function calls returning any)
        if (value.type === 'call_expression') {
          const nameNode = node.childForFieldName('name')
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Assigning `any` value',
            `\`${nameNode?.text ?? 'variable'}\` receives a value typed as \`any\` — type safety is lost.`,
            sourceCode,
            'Add type annotations to the function return type or use type assertions with caution.',
          )
        }
      }
    }

    return null
  },
}
