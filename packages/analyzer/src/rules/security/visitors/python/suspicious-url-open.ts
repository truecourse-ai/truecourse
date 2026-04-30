import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// True if the assignment to `varName` in the enclosing function body comes
// from a config-shaped source: `os.getenv(...)` / `os.environ[...]` /
// `config.X` / `settings.X`. These are server-controlled values, not user
// input from a request, so they don't enable SSRF.
function isConfigSourcedVar(node: SyntaxNode, varName: string): boolean {
  let func: SyntaxNode | null = node.parent
  while (func) {
    if (func.type === 'function_definition') break
    func = func.parent
  }
  // Search the whole module if not in a function (e.g. module-level assignments).
  let scope: SyntaxNode | null = func ? func.childForFieldName('body') : node.tree.rootNode
  if (!scope) return false

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'assignment') {
      const lhs = n.childForFieldName('left')
      const rhs = n.childForFieldName('right')
      if (lhs?.type === 'identifier' && lhs.text === varName && rhs) {
        const text = rhs.text
        if (
          /\bos\.getenv\b|\bos\.environ\b|\bconfig\.|\bsettings\.|\bSettings\(\)|\bConfig\(\)/.test(text)
        ) {
          found = true
          return
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(scope)
  return found
}

export const pythonSuspiciousUrlOpenVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/suspicious-url-open',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'urlopen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Plain string literal — safe.
    if (firstArg.type === 'string' && !firstArg.text.startsWith('f')) return null

    // Identifier that traces back to a config-shaped assignment in the
    // same function body. `webhook_url = os.getenv("X")` followed by
    // `urlopen(webhook_url)` is a deployment-config pattern, not SSRF.
    if (firstArg.type === 'identifier' && isConfigSourcedVar(node, firstArg.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'urlopen with user-controlled URL',
      `${objectName ? objectName + '.' : ''}urlopen() called with a non-literal URL. User-controlled URLs enable SSRF.`,
      sourceCode,
      'Validate and allowlist URLs before passing them to urlopen().',
    )
  },
}
