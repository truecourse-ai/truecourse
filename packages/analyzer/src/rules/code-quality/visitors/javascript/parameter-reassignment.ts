import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const parameterReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/parameter-reassignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const params = node.childForFieldName('parameters')
    if (!params) return null

    const paramNames = new Set<string>()
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i)
      if (p) {
        if (p.type === 'identifier') paramNames.add(p.text)
        else if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
          const nameNode = p.childForFieldName('pattern') ?? p.namedChildren[0]
          if (nameNode?.type === 'identifier') paramNames.add(nameNode.text)
        } else if (p.type === 'assignment_pattern') {
          const left = p.childForFieldName('left')
          if (left?.type === 'identifier') paramNames.add(left.text)
        } else if (p.type === 'rest_pattern') {
          const inner = p.namedChildren[0]
          if (inner?.type === 'identifier') paramNames.add(inner.text)
        }
      }
    }

    if (paramNames.size === 0) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Detect if an ancestor chain places `assignNode` inside an `if`/ternary branch
    // that guards on `paramName` being undefined / null / falsy. This is the
    // common "default-value normalization" pattern:
    //   if (param === undefined) param = fallback
    //   if (!param) param = fallback
    // which is idiomatic and should not be flagged.
    function isInsideDefaultValueGuard(assignNode: SyntaxNode, paramName: string): boolean {
      let current: SyntaxNode | null = assignNode
      let prev: SyntaxNode | null = null
      while (current && current.id !== bodyNode!.id) {
        if (current.type === 'if_statement') {
          // Only treat as guard if assignNode lives in the consequence branch.
          const consequence = current.childForFieldName('consequence')
          if (prev && consequence && (prev.id === consequence.id || isDescendantOf(prev, consequence))) {
            const condition = current.childForFieldName('condition')
            if (condition && conditionGuardsParam(condition, paramName)) return true
          }
        } else if (current.type === 'ternary_expression') {
          const consequence = current.childForFieldName('consequence')
          if (prev && consequence && (prev.id === consequence.id || isDescendantOf(prev, consequence))) {
            const condition = current.childForFieldName('condition')
            if (condition && conditionGuardsParam(condition, paramName)) return true
          }
        }
        prev = current
        current = current.parent
      }
      return false
    }

    function isDescendantOf(maybeChild: SyntaxNode, ancestor: SyntaxNode): boolean {
      let cur: SyntaxNode | null = maybeChild.parent
      while (cur) {
        if (cur.id === ancestor.id) return true
        cur = cur.parent
      }
      return false
    }

    // True if `cond` checks that `paramName` is undefined / null / falsy.
    // Handles:  !param  |  param == null  |  param === undefined  |  param === null
    //          typeof param === 'undefined'  |  parenthesized variants
    function conditionGuardsParam(cond: SyntaxNode, paramName: string): boolean {
      const c = unwrapParen(cond)
      // `!param`
      if (c.type === 'unary_expression') {
        const op = c.child(0)
        const arg = c.childForFieldName('argument') ?? c.namedChildren[0]
        if (op?.text === '!' && arg) {
          const a = unwrapParen(arg)
          if (a.type === 'identifier' && a.text === paramName) return true
        }
        return false
      }
      // Binary equality: param === undefined / param == null / param === null / typeof param === 'undefined'
      if (c.type === 'binary_expression') {
        const op = c.childForFieldName('operator')?.text ?? ''
        if (op !== '===' && op !== '==' && op !== '!==' && op !== '!=') return false
        // Only '===' / '==' represent the falsy guard. '!=='/'!=' represent a truthy guard
        // which does NOT make a subsequent assignment a default-value fallback.
        if (op === '!==' || op === '!=') return false
        const left = c.childForFieldName('left')
        const right = c.childForFieldName('right')
        if (!left || !right) return false
        const lU = unwrapParen(left)
        const rU = unwrapParen(right)
        const isParamRef = (n: SyntaxNode) =>
          n.type === 'identifier' && n.text === paramName
        const isNullishLiteral = (n: SyntaxNode) => {
          if (n.type === 'null') return true
          if (n.type === 'undefined') return true
          if (n.type === 'identifier' && n.text === 'undefined') return true
          return false
        }
        if (isParamRef(lU) && isNullishLiteral(rU)) return true
        if (isParamRef(rU) && isNullishLiteral(lU)) return true
        // typeof param === 'undefined'
        const isTypeofParam = (n: SyntaxNode) => {
          if (n.type !== 'unary_expression') return false
          const opNode = n.child(0)
          const arg = n.childForFieldName('argument') ?? n.namedChildren[0]
          if (opNode?.text !== 'typeof' || !arg) return false
          const a = unwrapParen(arg)
          return a.type === 'identifier' && a.text === paramName
        }
        const isUndefinedString = (n: SyntaxNode) =>
          n.type === 'string' && /^["']undefined["']$/.test(n.text)
        if (isTypeofParam(lU) && isUndefinedString(rU)) return true
        if (isTypeofParam(rU) && isUndefinedString(lU)) return true
      }
      return false
    }

    function unwrapParen(n: SyntaxNode): SyntaxNode {
      let cur = n
      while (cur.type === 'parenthesized_expression') {
        const inner = cur.namedChildren[0]
        if (!inner) break
        cur = inner
      }
      return cur
    }

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return null

      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && paramNames.has(left.text)) {
          if (!isInsideDefaultValueGuard(n, left.text)) return left
        }
      }
      if (n.type === 'update_expression') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child?.type === 'identifier' && paramNames.has(child.text)) {
            if (!isInsideDefaultValueGuard(n, child.text)) return child
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const result = findReassignment(child)
          if (result) return result
        }
      }
      return null
    }

    const reassigned = findReassignment(bodyNode)
    if (reassigned) {
      return makeViolation(
        this.ruleKey, reassigned, filePath, 'medium',
        'Parameter reassignment',
        `Parameter \`${reassigned.text}\` is reassigned. Use a local variable instead to keep function parameters immutable.`,
        sourceCode,
        `Introduce a local variable: \`let local = ${reassigned.text};\` and modify that instead.`,
      )
    }
    return null
  },
}
