import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const implicitGlobalDeclarationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-global-declaration',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declaration', 'function_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag top-level declarations (parent is program/module)
    const parent = node.parent
    if (!parent) return null
    if (parent.type !== 'program') return null

    // Skip service workers and standalone scripts. Service workers run
    // in a dedicated `ServiceWorkerGlobalScope` (or DedicatedWorkerGlobalScope)
    // where top-level declarations are local to the worker, not the
    // page's global scope. Detect by filename or by `self.addEventListener`/
    // `importScripts` usage at the top of the file.
    const lowerPath = filePath.toLowerCase()
    if (
      /(?:service|sw|worker|service-worker|mockServiceWorker)\b/i.test(lowerPath) ||
      /\.(?:sw|worker|service-worker)\.[jt]sx?$/i.test(filePath)
    ) return null
    if (/\bself\.addEventListener\b|\bimportScripts\(/.test(sourceCode)) return null

    if (node.type === 'variable_declaration') {
      const kind = node.children[0]
      if (!kind || kind.text !== 'var') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Implicit global var declaration',
        '`var` declaration at global scope pollutes the global namespace.',
        sourceCode,
        'Use `let` or `const` inside a module, or wrap in an IIFE.',
      )
    }

    if (node.type === 'function_declaration') {
      // In ES modules, top-level declarations are module-scoped, not global.
      // Detect modules by presence of import/export statements.
      const program = parent
      for (let i = 0; i < program.namedChildCount; i++) {
        const child = program.namedChild(i)
        if (child && (child.type === 'import_statement' || child.type === 'export_statement')) {
          return null // ES module — function is module-scoped
        }
      }

      const name = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Function declaration in global scope: ${name?.text ?? 'fn'}`,
        'Function declaration at global scope creates a global variable.',
        sourceCode,
        'Wrap in a module or use an ES module export.',
      )
    }

    return null
  },
}
