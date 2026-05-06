import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const requireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Skip when the function has an explicit `Promise<T>` / `Awaited<T>`
    // return type — the async is fulfilling a typed contract. Removing
    // it would change the return type from Promise<T> to T.
    const returnType = node.childForFieldName('return_type')
    if (returnType && /\b(?:Promise|Awaited|PromiseLike|Thenable)\b/.test(returnType.text)) return null

    // Skip when the function is in JSX prop position — `onClick={async
    // () => …}` async lets the handler `await` later additions and
    // reads as "this returns a Promise, the framework will manage it".
    let p: typeof node.parent = node.parent
    while (p) {
      if (p.type === 'jsx_attribute') return null
      if (p.type === 'jsx_expression' && p.parent?.type === 'jsx_attribute') return null
      // Variable declarator with explicit Promise<T> annotation — same
      // contract reasoning as return type above.
      if (p.type === 'variable_declarator') {
        const ann = p.children.find((c) => c.type === 'type_annotation')
        if (ann && /\b(?:Promise|Awaited|PromiseLike|Thenable)\b/.test(ann.text)) return null
        break
      }
      // Don't escape past the immediate enclosing context.
      if (
        p.type === 'function_declaration' ||
        p.type === 'function_expression' ||
        p.type === 'arrow_function' ||
        p.type === 'method_definition' ||
        p.type === 'class_body' ||
        p.type === 'program'
      ) break
      p = p.parent
    }

    // Skip async methods of a class that has an `implements` clause —
    // those are interface/contract implementations.
    if (node.type === 'method_definition') {
      let cls: typeof node.parent = node.parent
      while (cls) {
        if (cls.type === 'class_declaration' || cls.type === 'class') {
          const heritage = cls.namedChildren.find((c) => c.type === 'class_heritage')
          if (heritage && /\bimplements\b/.test(heritage.text)) return null
          // Also skip when class extends a parent — the async signature may
          // be required by the parent's contract.
          if (heritage && /\bextends\b/.test(heritage.text)) return null
          break
        }
        cls = cls.parent
      }
    }

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await_expression') {
        hasAwait = true
        return
      }
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async without await',
        `Async function \`${name}\` does not use \`await\`. Remove the \`async\` keyword or add an \`await\`.`,
        sourceCode,
        'Remove the `async` keyword if the function does not need to be async.',
      )
    }
    return null
  },
}
