import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingFunctionBody, getCSharpMethodName, getCSharpReceiver, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'

/** Wrapper types that open an OS file handle when constructed from a path. */
const PATH_WRAPPER_TYPES = new Set(['StreamReader', 'StreamWriter'])

/** Static factory methods on System.IO.File that open a handle. */
const FILE_OPEN_METHODS = new Set(['Open', 'OpenRead', 'OpenWrite', 'OpenText', 'Create', 'CreateText', 'AppendText'])

const DISPOSE_METHODS = new Set(['Dispose', 'DisposeAsync', 'Close'])

function simpleTypeName(typeNode: SyntaxNode | null): string {
  if (!typeNode) return ''
  if (typeNode.type === 'qualified_name') return typeNode.childForFieldName('name')?.text ?? ''
  if (typeNode.type === 'generic_name') return typeNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
  return typeNode.text
}

/** Does this initializer acquire a file handle? Returns a display name, or null. */
function fileAcquisition(init: SyntaxNode): string | null {
  if (init.type === 'object_creation_expression') {
    const typeName = simpleTypeName(init.childForFieldName('type'))
    if (typeName === 'FileStream') return 'new FileStream(…)'
    if (PATH_WRAPPER_TYPES.has(typeName)) {
      // Only the path-based overloads (`new StreamReader("a.txt")` /
      // `new StreamReader(path)`) clearly own the handle; the
      // stream-wrapping overloads share ownership with the caller.
      const firstArg = init.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0]
      if (!firstArg) return null
      if (isCSharpStringNode(firstArg)) return `new ${typeName}(…)`
      const argName = firstArg.type === 'member_access_expression'
        ? firstArg.childForFieldName('name')?.text ?? ''
        : firstArg.type === 'identifier' ? firstArg.text : ''
      if (/(?:path|file|filename)$/i.test(argName)) return `new ${typeName}(…)`
    }
    return null
  }
  if (init.type === 'invocation_expression') {
    if ((getCSharpReceiver(init).split('.').pop() ?? '') !== 'File') return null
    const method = getCSharpMethodName(init)
    if (FILE_OPEN_METHODS.has(method)) return `File.${method}(…)`
  }
  return null
}

/**
 * File handle opened into a local with no `using`, never disposed, and never
 * handed off (returned / passed / stored) — the handle leaks until
 * finalization, keeping the file locked on Windows. The C# analog of
 * `open()` without `with`.
 *
 * Declarations inside any `try` are skipped: try/finally-dispose is the
 * legitimate manual pattern and try-scoped leaks belong to
 * reliability/missing-finally-cleanup. DB connections belong to
 * database/connection-not-released.
 */
export const csharpOpenFileWithoutContextManagerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/open-file-without-context-manager',
  languages: ['csharp'],
  nodeTypes: ['local_declaration_statement'],
  visit(node, filePath, sourceCode) {
    // `using var f = …;` — already managed.
    if (node.children.some((c) => c?.type === 'using')) return null

    const varDecl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const declarator = varDecl?.namedChildren.find((c) => c?.type === 'variable_declarator')
    if (!declarator) return null
    const nameNode = declarator.childForFieldName('name')
    if (!nameNode) return null
    const init = declarator.namedChildren[declarator.namedChildren.length - 1]
    if (!init || init.id === nameNode.id) return null
    const what = fileAcquisition(init)
    if (!what) return null

    // Inside a try → owned by missing-finally-cleanup / manual finally pattern.
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'try_statement') return null
      ancestor = ancestor.parent
    }

    const scope = getCSharpEnclosingFunctionBody(node) ?? node.parent
    if (!scope) return null
    const varName = nameNode.text

    let handled = false
    function checkUse(idNode: SyntaxNode): void {
      // Disposed or closed explicitly?
      const parent = idNode.parent
      if (parent?.type === 'member_access_expression'
        && parent.childForFieldName('expression')?.id === idNode.id
        && DISPOSE_METHODS.has(parent.childForFieldName('name')?.text ?? '')) {
        handled = true
        return
      }
      if (parent?.type === 'conditional_access_expression') {
        handled = true // fs?.Dispose() and friends — conservatively safe
        return
      }
      // Ownership handed off: returned, yielded, passed, stored, aliased,
      // or used as a `using (fs)` resource.
      let current: SyntaxNode | null = idNode
      let up: SyntaxNode | null = idNode.parent
      while (up && current!.id !== scope!.id) {
        if (up.type === 'return_statement' || up.type === 'yield_statement'
          || up.type === 'argument' || up.type === 'arrow_expression_clause') {
          handled = true
          return
        }
        if (up.type === 'assignment_expression' && up.childForFieldName('right')?.id === current!.id) {
          handled = true
          return
        }
        // Direct aliasing (`var copy = reader;`) hands the handle to another
        // local; `var line = reader.ReadLine();` does not.
        if (up.type === 'variable_declarator' && current!.id === idNode.id) {
          handled = true
          return
        }
        if (up.type === 'using_statement' && up.childForFieldName('body')?.id !== current!.id) {
          handled = true
          return
        }
        current = up
        up = up.parent
      }
    }

    function walk(n: SyntaxNode): void {
      if (handled) return
      if (n.type === 'identifier' && n.text === varName && n.id !== nameNode!.id) checkUse(n)
      for (const child of n.namedChildren) {
        if (child) walk(child)
      }
    }
    walk(scope)
    if (handled) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'File opened without using',
      `\`${what}\` opens a file handle that is never disposed — the file stays locked until the finalizer eventually runs.`,
      sourceCode,
      'Declare it with `using`: `using var stream = …;` (or wrap in `using (…) { … }`).',
    )
  },
}
