import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/** Collection-mutating methods that invalidate `foreach` over the same collection. */
const MUTATORS = new Set(['Add', 'AddRange', 'Remove', 'RemoveAt', 'RemoveAll', 'RemoveRange', 'Insert', 'InsertRange', 'Clear', 'Sort', 'Reverse'])

function isIncrementOf(update: SyntaxNode, indexName: string): boolean {
  if (update.type === 'postfix_unary_expression' || update.type === 'prefix_unary_expression') {
    const op = update.children.find((c) => c?.type === '++')
    const operand = update.namedChildren[0]
    return !!op && operand?.type === 'identifier' && operand.text === indexName
  }
  if (update.type === 'assignment_expression') {
    const left = update.childForFieldName('left')
    const op = update.childForFieldName('operator')?.text
    const right = update.childForFieldName('right')
    return left?.type === 'identifier' && left.text === indexName
      && op === '+=' && right?.text === '1'
  }
  return false
}

/**
 * `for (int i = 0; i < xs.Count; i++)` where `i` is only ever used to READ
 * `xs[i]` — a `foreach` says the same thing without index bookkeeping.
 * Skipped whenever the index is used for anything else, when `xs[i]` is
 * written, or when the body mutates the collection (foreach would throw).
 */
export const csharpIndexedLoopOverForOfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/indexed-loop-over-for-of',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const initializer = node.childForFieldName('initializer')
    const condition = node.childForFieldName('condition')
    const update = node.childForFieldName('update')
    const body = node.childForFieldName('body')
    if (!initializer || !condition || !update || !body) return null

    if (initializer.type !== 'variable_declaration') return null
    const declarators = initializer.namedChildren.filter((c) => c?.type === 'variable_declarator')
    if (declarators.length !== 1) return null
    const declarator = declarators[0]!
    const indexNode = declarator.childForFieldName('name')
    if (indexNode?.type !== 'identifier') return null
    const indexName = indexNode.text
    const initValue = declarator.namedChildren[declarator.namedChildren.length - 1]
    if (declarator.namedChildren.length < 2 || initValue?.text !== '0') return null

    if (!isIncrementOf(update, indexName)) return null

    // Condition must be `i < xs.Count` / `i < xs.Length`.
    if (condition.type !== 'binary_expression') return null
    if (condition.childForFieldName('operator')?.text !== '<') return null
    const condLeft = condition.childForFieldName('left')
    const bound = condition.childForFieldName('right')
    if (condLeft?.type !== 'identifier' || condLeft.text !== indexName) return null
    if (bound?.type !== 'member_access_expression') return null
    const boundProp = bound.childForFieldName('name')?.text
    if (boundProp !== 'Count' && boundProp !== 'Length') return null
    const collectionText = bound.childForFieldName('expression')?.text
    if (!collectionText) return null

    let disqualified = false
    let elementReads = 0

    function walk(n: SyntaxNode): void {
      if (disqualified) return
      if (n.type === 'identifier' && n.text === indexName) {
        const parent = n.parent
        // Allowed only as `xs[i]` where xs is the bounded collection…
        const argList = parent?.type === 'argument' ? parent.parent : null
        const elementAccess = argList?.type === 'bracketed_argument_list' ? argList.parent : null
        if (
          elementAccess?.type === 'element_access_expression' &&
          elementAccess.childForFieldName('expression')?.text === collectionText
        ) {
          // …and only as a READ: `xs[i] = …`, `xs[i]++`, `ref xs[i]` need the index.
          const accessParent = elementAccess.parent
          if (accessParent?.type === 'assignment_expression'
            && accessParent.childForFieldName('left')?.id === elementAccess.id) {
            disqualified = true
            return
          }
          if (accessParent?.type === 'postfix_unary_expression' || accessParent?.type === 'prefix_unary_expression') {
            disqualified = true
            return
          }
          // `Foo(ref xs[i])` / `Foo(out xs[i])` — the element is written through.
          if (accessParent?.type === 'argument' && accessParent.children.some((c) => c?.type === 'ref' || c?.type === 'out')) {
            disqualified = true
            return
          }
          elementReads++
          return
        }
        disqualified = true
        return
      }
      // Body mutating the collection invalidates foreach.
      if (n.type === 'invocation_expression'
        && getCSharpReceiver(n) === collectionText
        && MUTATORS.has(getCSharpMethodName(n))) {
        disqualified = true
        return
      }
      for (const child of n.namedChildren) {
        if (child) walk(child)
      }
    }
    walk(body)

    if (disqualified || elementReads === 0) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Indexed loop where foreach suffices',
      `Index \`${indexName}\` is only used to read \`${collectionText}[${indexName}]\` — a \`foreach\` expresses the iteration without index bookkeeping.`,
      sourceCode,
      `Replace with \`foreach (var item in ${collectionText}) { … }\`.`,
    )
  },
}
