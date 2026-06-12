import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingFunctionBody, getCSharpRootNode, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { getCSharpChainRoot, getCSharpSimpleTypeName } from './_helpers.js'

/**
 * C# port of "addEventListener without removeEventListener": an event
 * subscription (`publisher.SomeEvent += Handler`) with no matching `-=`
 * anywhere in the file. Subscribing a shorter-lived object to a longer-lived
 * publisher (injected dependency, static event) roots the subscriber and is
 * the classic .NET memory leak.
 *
 * Skipped to keep precision:
 *   - receivers that are locals of the same method (lifetime is local)
 *   - `this.X += ...` (self-subscription dies with the object)
 *   - terminal-lifecycle events (ProcessExit, Exited, …) where
 *     unsubscription is pointless
 * The += must be recognizably a delegate: lambda, anonymous method,
 * `new ...Handler(...)`, or a method group naming a method declared in the
 * file — this is what keeps numeric `+=` out.
 */
const LIFECYCLE_EVENTS = new Set([
  'Disposed', 'Exited', 'ProcessExit', 'UnhandledException',
  'CancelKeyPress', 'ApplicationStopping', 'ApplicationStopped', 'Unloading',
])

function collectDeclaredMethodNames(root: SyntaxNode): Set<string> {
  const names = new Set<string>()
  walkCSharp(root, (n: SyntaxNode) => {
    if (n.type === 'method_declaration' || n.type === 'local_function_statement') {
      const name = n.childForFieldName('name')?.text
      if (name) names.add(name)
    }
  })
  return names
}

function isDelegateRhs(right: SyntaxNode, methodNames: Set<string>): boolean {
  if (right.type === 'lambda_expression' || right.type === 'anonymous_method_expression') return true
  if (right.type === 'object_creation_expression') {
    const typeName = getCSharpSimpleTypeName(right.childForFieldName('type'))
    return /Handler$|^Action$|^EventHandler/.test(typeName)
  }
  if (right.type === 'identifier') return methodNames.has(right.text)
  if (right.type === 'member_access_expression') {
    const name = right.childForFieldName('name')?.text
    return name !== undefined && methodNames.has(name)
  }
  return false
}

function isLocalOfEnclosingFunction(node: SyntaxNode, name: string): boolean {
  const body = getCSharpEnclosingFunctionBody(node)
  if (!body) return false
  let declared = false
  walkCSharp(body, (n: SyntaxNode) => {
    if (n.type === 'variable_declarator' && n.childForFieldName('name')?.text === name) {
      declared = true
    }
  })
  return declared
}

function fileHasUnsubscribe(root: SyntaxNode, eventName: string): boolean {
  let found = false
  walkCSharp(root, (n: SyntaxNode) => {
    if (found || n.type !== 'assignment_expression') return
    if (n.childForFieldName('operator')?.text !== '-=') return
    const left = n.childForFieldName('left')
    const name = left?.type === 'member_access_expression'
      ? left.childForFieldName('name')?.text
      : left?.text
    if (name === eventName) found = true
  })
  return found
}

export const csharpEventListenerNoRemoveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/event-listener-no-remove',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '+=') return null

    const left = node.childForFieldName('left')
    if (left?.type !== 'member_access_expression') return null
    const eventName = left.childForFieldName('name')?.text
    if (!eventName || LIFECYCLE_EVENTS.has(eventName)) return null

    const right = node.childForFieldName('right')
    if (!right) return null

    const root = getCSharpRootNode(node)
    if (!isDelegateRhs(right, collectDeclaredMethodNames(root))) return null

    const receiverRoot = getCSharpChainRoot(left.childForFieldName('expression') ?? left)
    if (receiverRoot.type === 'this_expression') return null
    if (receiverRoot.type === 'identifier' && isLocalOfEnclosingFunction(node, receiverRoot.text)) return null

    if (fileHasUnsubscribe(root, eventName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Event subscription without unsubscription',
      `Subscribing to ${left.text} without a matching -= keeps this object reachable from the publisher — a memory leak when the publisher outlives the subscriber.`,
      sourceCode,
      `Unsubscribe with ${left.text} -= ... (typically in Dispose()) or use a weak event pattern.`,
    )
  },
}
