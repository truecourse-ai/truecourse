import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/index.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects test functions that modify module-level (outer-scope) variables
 * without cleaning up in an afterEach/afterAll — this pollutes test isolation.
 */

const TEST_FUNCTION_NAMES = new Set(['it', 'test', 'describe', 'beforeEach', 'beforeAll'])

function getCallbackArgument(callNode: SyntaxNode): SyntaxNode | null {
  const args = callNode.childForFieldName('arguments')
  if (!args) return null
  // The callback is typically the last argument (function or arrow_function)
  for (let i = args.namedChildCount - 1; i >= 0; i--) {
    const arg = args.namedChild(i)
    if (!arg) continue
    if (arg.type === 'arrow_function' || arg.type === 'function_expression' || arg.type === 'function') {
      return arg
    }
  }
  return null
}

function findAssignments(bodyNode: SyntaxNode): Array<{ name: string; node: SyntaxNode }> {
  const results: Array<{ name: string; node: SyntaxNode }> = []

  function walk(n: SyntaxNode) {
    // Skip nested function boundaries
    if (n !== bodyNode && (n.type === 'function_declaration' || n.type === 'function_expression'
      || n.type === 'arrow_function' || n.type === 'method_definition')) return

    if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left')
      if (left?.type === 'identifier') {
        results.push({ name: left.text, node: n })
      }
    }

    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }

  walk(bodyNode)
  return results
}

export const testModifyingGlobalStateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-modifying-global-state',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null

    // Check if this is a test function call: it(...), test(...), describe(...)
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Handle both `it(...)` and `suite.it(...)` — just get the rightmost identifier
    const calleeName = fn.type === 'member_expression'
      ? (fn.childForFieldName('property')?.text ?? '')
      : fn.text

    if (!TEST_FUNCTION_NAMES.has(calleeName)) return null

    const callback = getCallbackArgument(node)
    if (!callback) return null

    const body = callback.childForFieldName('body')
    if (!body) return null

    // Find all assignments inside the test body
    const assignments = findAssignments(body)
    if (assignments.length === 0) return null

    // Get the scope of the test callback
    const callbackScope = dataFlow.getScopeForNode(callback)
    if (!callbackScope) return null

    for (const { name, node: assignNode } of assignments) {
      // Resolve the identifier being assigned
      const identifierNode = assignNode.childForFieldName('left')
      if (!identifierNode) continue

      const variable = dataFlow.resolveReference(identifierNode)
      if (!variable) continue

      // If the variable is declared in an outer scope (module or parent function), it's global state
      const varScope = variable.scope
      if (varScope.kind === 'module') {
        return makeViolation(
          this.ruleKey,
          assignNode,
          filePath,
          'high',
          'Test modifying global state without cleanup',
          `Test \`${calleeName}\` assigns to module-level variable \`${name}\` without cleanup — this can pollute other tests.`,
          sourceCode,
          'Restore the original value in an `afterEach` block or use dependency injection instead.',
        )
      }
    }

    return null
  },
}
