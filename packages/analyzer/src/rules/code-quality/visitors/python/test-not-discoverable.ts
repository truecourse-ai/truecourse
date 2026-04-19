import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isPythonTestFile, containsNodeOfType } from '../../../_shared/python-helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/** Walk for `self.assert*()` method calls (unittest-style assertions). */
function containsAssertMethodCall(node: SyntaxNode): boolean {
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text.startsWith('assert')) return true
    }
  }
  for (const child of node.namedChildren) {
    if (containsAssertMethodCall(child)) return true
  }
  return false
}

/**
 * Detects test methods in test classes that don't follow naming conventions
 * (i.e., don't start with `test_`) — pytest won't discover them.
 */
export const pythonTestNotDiscoverableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-not-discoverable',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Only check classes in test files or Test* classes
    const classNameNode = node.childForFieldName('name')
    if (!classNameNode) return null
    const className = classNameNode.text

    const isTestClass =
      className.startsWith('Test') ||
      className.endsWith('Test') ||
      className.endsWith('Tests')

    const isTestFile = isPythonTestFile(filePath)

    if (!isTestClass && !isTestFile) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    for (const child of body.namedChildren) {
      if (child.type !== 'function_definition' && child.type !== 'decorated_definition') continue

      const funcNode = child.type === 'decorated_definition'
        ? child.namedChildren.find((c) => c.type === 'function_definition')
        : child
      if (!funcNode) continue

      const nameNode = funcNode.childForFieldName('name')
      if (!nameNode) continue
      const name = nameNode.text

      // Skip special methods and already correctly named test methods
      if (name.startsWith('test_') || name.startsWith('_') || name.startsWith('setUp') || name.startsWith('tearDown') || name === 'setUp' || name === 'tearDown') continue

      // Check if the function body contains assertions (indicates it's a test)
      const funcBody = funcNode.childForFieldName('body')
      if (!funcBody) continue
      const hasAssertions = containsNodeOfType(funcBody, 'assert_statement') || containsAssertMethodCall(funcBody)
      if (!hasAssertions) continue

      return makeViolation(
        this.ruleKey, funcNode, filePath, 'high',
        'Test method not discoverable',
        `Method \`${name}\` in \`${className}\` looks like a test but doesn't start with \`test_\` — pytest will not discover it.`,
        sourceCode,
        `Rename \`${name}\` to \`test_${name}\` to make it discoverable.`,
      )
    }

    return null
  },
}
