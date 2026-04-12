import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonModuleNode } from '../../../_shared/python-helpers.js'

const ROOT_LOGGER_METHODS = new Set(['debug', 'info', 'warning', 'error', 'critical', 'exception', 'log'])

/** Per-module cache: does this file have a top-level `if __name__ == "__main__":` guard? */
const scriptLikeCache = new WeakMap<SyntaxNode, boolean>()

function isScriptLikeFile(node: SyntaxNode): boolean {
  const module = getPythonModuleNode(node)
  const cached = scriptLikeCache.get(module)
  if (cached !== undefined) return cached

  let found = false
  for (const child of module.namedChildren) {
    if (child.type === 'if_statement') {
      const condition = child.childForFieldName('condition')
      if (condition?.type === 'comparison_operator') {
        const hasName = condition.namedChildren.some((c) => c.type === 'identifier' && c.text === '__name__')
        const hasMain = condition.namedChildren.some((c) => c.type === 'string' && c.text.replace(/^['"]|['"]$/g, '') === '__main__')
        if (hasName && hasMain) { found = true; break }
      }
    }
  }
  scriptLikeCache.set(module, found)
  return found
}

export const pythonLoggingRootLoggerCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-root-logger-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text === 'logging' && attr && ROOT_LOGGER_METHODS.has(attr.text)) {
      // Skip script-like files — scripts/CLI tools legitimately use the
      // root logger since they're the top-level entry point.
      if (isScriptLikeFile(node)) return null

      // Skip files in common script/tool directories
      const segments = filePath.split('/')
      const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''
      if (dirName === 'scripts' || dirName === 'bin' || dirName === 'tools' || dirName === 'cli' || dirName === 'cmd') {
        return null
      }

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Root logger call',
        `\`logging.${attr.text}()\` calls the root logger directly. Use a named logger via \`logging.getLogger(__name__)\` for proper log categorization.`,
        sourceCode,
        'Create a module-level logger: `logger = logging.getLogger(__name__)` and call `logger.' + attr.text + '(...)` instead.',
      )
    }

    return null
  },
}
