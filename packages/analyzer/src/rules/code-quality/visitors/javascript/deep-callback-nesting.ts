import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Method names whose arrow-arg semantics are "pattern arm" or
// "query-builder lambda" rather than "nested callback". Calling
// `.with(value, () => ...)` is a switch-case body inside a
// `match(x).with(...)...exhaustive()` chain. Counting these as
// nesting-depth contributors penalizes a flat dispatch as if it
// were nested control flow.
const PATTERN_ARM_METHODS = new Set([
  'with', 'otherwise', 'when', 'exhaustive', 'returnType',
])

// Property names on Kysely / Drizzle / Prisma query-builder
// option bags whose arrow value is a query DSL, not nested
// control flow.
const QUERY_BUILDER_PROP_NAMES = new Set([
  'where', 'select', 'set', 'orderBy', 'groupBy', 'having',
  'returning', 'on', 'as', 'leftJoin', 'innerJoin', 'rightJoin',
  'fullJoin', 'with', 'using', 'columns', 'values',
])

/**
 * True if the arrow function `node` is a direct argument to a
 * method whose method name is in PATTERN_ARM_METHODS — e.g.,
 * `.with(value, () => ...)` from `ts-pattern`.
 */
function isPatternArmArrow(node: SyntaxNode): boolean {
  const args = node.parent
  if (args?.type !== 'arguments') return false
  const call = args.parent
  if (call?.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const prop = fn.childForFieldName('property')
  return prop ? PATTERN_ARM_METHODS.has(prop.text) : false
}

/**
 * True if the arrow function `node` is the value of an
 * object-literal property whose key matches a known query-
 * builder option-bag prop (`{ where: (eb) => … }`).
 */
function isQueryBuilderOptionBagArrow(node: SyntaxNode): boolean {
  const pair = node.parent
  if (pair?.type !== 'pair') return false
  const key = pair.childForFieldName('key')
  const keyName = key?.type === 'property_identifier' ? key.text :
    (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
  return keyName ? QUERY_BUILDER_PROP_NAMES.has(keyName) : false
}

export const deepCallbackNestingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deep-callback-nesting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    // Skip arrows that are themselves pattern-arm bodies or
    // query-builder option-bag values. Their callers are flat
    // dispatch / DSL constructs, not control-flow nesting.
    if (isPatternArmArrow(node)) return null
    if (isQueryBuilderOptionBagArrow(node)) return null

    let depth = 0
    let parent = node.parent
    let insideJsxExpression = false
    let prevCallNode: typeof parent = null

    while (parent) {
      if (parent.type === 'jsx_expression') {
        insideJsxExpression = true
      }

      if (parent.type === 'arguments') {
        // Don't double-count consecutive method-chain arguments
        // produced by `a.b(x).c(y).d(z)` — each link in the chain
        // adds an `arguments` parent on the way up, but the chain
        // is a single horizontal flow, not vertical nesting. We
        // count one level per distinct `call_expression` whose
        // function isn't a chained member access of the prior
        // call's result.
        const callNode = parent.parent
        const isChainContinuation =
          prevCallNode != null &&
          callNode?.type === 'call_expression' &&
          (() => {
            const fn = callNode.childForFieldName('function')
            if (fn?.type !== 'member_expression') return false
            // The receiver of this method call is the previous call
            // (i.e., `prev.then(...)`, `prev.map(...).filter(...)`).
            const obj = fn.childForFieldName('object')
            return obj?.id === prevCallNode.id
          })()

        // Don't count pattern-arm methods or query-builder
        // option-bag wrappers as a nesting level.
        let isPatternArm = false
        if (callNode?.type === 'call_expression') {
          const fn = callNode.childForFieldName('function')
          if (fn?.type === 'member_expression') {
            const propText = fn.childForFieldName('property')?.text ?? ''
            if (PATTERN_ARM_METHODS.has(propText)) isPatternArm = true
          }
        }

        if (!isChainContinuation && !isPatternArm) {
          depth++
        }
        prevCallNode = callNode
      }

      if ((parent.type === 'function_declaration') || parent.type === 'program') break

      parent = parent.parent
    }

    const threshold = insideJsxExpression ? 5 : 4
    if (depth >= threshold) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deep callback nesting',
        `Callback nested ${depth} levels deep — refactor using async/await or named functions.`,
        sourceCode,
        'Extract nested callbacks into named functions or use async/await to flatten the nesting.',
      )
    }
    return null
  },
}
