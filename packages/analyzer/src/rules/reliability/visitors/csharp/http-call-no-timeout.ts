import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingFunctionBody, getCSharpRootNode, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/**
 * `new HttpClient()` with no explicit Timeout configured. Unlike fetch(),
 * HttpClient is not unbounded — the default Timeout is 100 seconds — but
 * relying on it means every hung dependency stalls callers for 100s, which
 * for service-to-service calls is an outage, not a timeout. The flag is on
 * the direct construction, where the author owns configuration.
 *
 * Precision choices:
 *   - clients from IHttpClientFactory (`factory.CreateClient(...)`) are never
 *     flagged — their timeout is configured centrally at registration;
 *   - skipped when `Timeout` is set in the object initializer or assigned on
 *     the same variable/field anywhere in the enclosing method (or, for field
 *     initializers, the enclosing class);
 *   - skipped when the enclosing scope mentions CancellationToken — per-call
 *     tokens are the other idiomatic way to bound request time;
 *   - constructions that are immediately returned or passed as an argument
 *     are skipped (the receiver may configure the client).
 */
export const csharpHttpCallNoTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/http-call-no-timeout',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = simpleTypeName(node.childForFieldName('type')?.text ?? '')
    if (typeName !== 'HttpClient') return null

    // `new HttpClient { Timeout = … }`
    const initializer = node.childForFieldName('initializer')
    if (initializer) {
      for (const entry of initializer.namedChildren) {
        if (entry?.type !== 'assignment_expression') continue
        if (entry.childForFieldName('left')?.text === 'Timeout') return null
      }
    }

    // Find what the client is assigned to. No target (returned / passed
    // inline) → the consumer may configure it; skip.
    let target: string | null = null
    const parent = node.parent
    if (parent?.type === 'variable_declarator') {
      target = parent.namedChildren[0]?.type === 'identifier' ? parent.namedChildren[0]!.text : null
    } else if (parent?.type === 'assignment_expression' && parent.childForFieldName('right')?.id === node.id) {
      target = parent.childForFieldName('left')?.text ?? null
    }
    if (!target) return null

    // Search the enclosing scope (method body; class body for field
    // initializers) for `<target>.Timeout = …`.
    let scope: SyntaxNode | null = getCSharpEnclosingFunctionBody(node)
    if (!scope) {
      let current: SyntaxNode | null = node.parent
      while (current && current.type !== 'class_declaration' && current.type !== 'struct_declaration') {
        current = current.parent
      }
      scope = current?.namedChildren.find((c) => c?.type === 'declaration_list') ?? getCSharpRootNode(node)
    }

    let configured = false
    walkCSharp(scope, (n) => {
      if (configured || n.type !== 'assignment_expression') return
      const left = n.childForFieldName('left')
      if (left?.type !== 'member_access_expression') return
      if (
        left.childForFieldName('name')?.text === 'Timeout' &&
        left.childForFieldName('expression')?.text === target
      ) configured = true
    })
    if (configured) return null

    // CancellationToken in scope — the author bounds requests per call.
    if (scope.text.includes('CancellationToken')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'HttpClient without explicit timeout',
      'new HttpClient() relies on the 100-second default Timeout. A hung dependency stalls every caller for 100s before failing.',
      sourceCode,
      'Set client.Timeout (or pass a CancellationToken per request), e.g. new HttpClient { Timeout = TimeSpan.FromSeconds(10) }.',
    )
  },
}
