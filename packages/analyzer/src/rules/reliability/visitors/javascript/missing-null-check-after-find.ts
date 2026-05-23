import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function isArrayTypeString(t: string): boolean {
  // Strip leading "readonly " modifier.
  let s = t.startsWith('readonly ') ? t.slice('readonly '.length) : t
  // T[] (possibly with whitespace) — accept anything ending in `]`
  if (s.endsWith('[]') || /\]\s*$/.test(s)) return true
  // Array<T>, ReadonlyArray<T>, ConcatArray<T>
  if (/^(Readonly|Concat)?Array<.+>$/.test(s)) return true
  return false
}

export const missingNullCheckAfterFindVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-null-check-after-find',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'find') return null

    // Selector-style `.find(stringLiteral)` is never `Array.prototype.find`
    // (whose only argument is a predicate callback). Konva, jQuery, Cheerio,
    // Playwright locators etc. all use string selectors. Skip syntactically
    // — works even without resolved type info (e.g. node_modules absent).
    const args = node.childForFieldName('arguments')
    const firstArg = args?.namedChild(0)
    if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
      return null
    }

    // Not every `.find()` is `Array.prototype.find`. Konva's `Node.find`,
    // jQuery's `$.find`, Cheerio's selector `.find` etc. all return arrays
    // — there's no possibility of `undefined`, so chained access is safe.
    // When type info is available, skip when the return type is an array.
    if (typeQuery) {
      const returnType = typeQuery.getTypeString(
        filePath,
        node.startPosition.row,
        node.startPosition.column,
        node.endPosition.row,
        node.endPosition.column,
      )
      if (returnType && isArrayTypeString(returnType)) return null
    }

    // Check how the result is used — look at parent
    const parent = node.parent
    if (!parent) return null

    // Skip if optional chaining is used: arr.find(...)?.property
    if (parent.type === 'optional_chain_expression') return null

    // Skip when the parent is a member_expression using optional chaining (?.).
    // tree-sitter-typescript inserts an `optional_chain` child between the
    // object and the property; that's whitespace-insensitive (handles wrapped
    // chains like `arr.find(cb)\n  ?.prop`).
    if (parent.type === 'member_expression' && parent.childForFieldName('object')?.id === node.id) {
      for (let i = 0; i < parent.namedChildCount; i++) {
        if (parent.namedChild(i)?.type === 'optional_chain') return null
      }
    }

    // If result is used in member access immediately: arr.find(...).property
    if (parent.type === 'member_expression' && parent.childForFieldName('object')?.id === node.id) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Missing null check after .find()',
        '.find() may return undefined. Accessing a property on the result without a null check can throw.',
        sourceCode,
        'Check the .find() result for undefined before accessing properties (use optional chaining ?. or an if check).',
      )
    }

    // If result is used in a call: arr.find(...).method()
    if (parent.type === 'call_expression') {
      const parentFn = parent.childForFieldName('function')
      if (parentFn?.type === 'member_expression' && parentFn.childForFieldName('object')?.id === node.id) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Missing null check after .find()',
          '.find() may return undefined. Calling a method on the result without a null check can throw.',
          sourceCode,
          'Check the .find() result for undefined before calling methods on it.',
        )
      }
    }

    return null
  },
}
