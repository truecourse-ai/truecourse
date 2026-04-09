import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNonlocalWithoutBindingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nonlocal-without-binding',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Collect nonlocal declarations in this function
    const nonlocalVars: Array<{ name: string; node: import('tree-sitter').SyntaxNode }> = []
    for (const stmt of body.namedChildren) {
      if (stmt.type === 'nonlocal_statement') {
        for (const child of stmt.namedChildren) {
          if (child.type === 'identifier') {
            nonlocalVars.push({ name: child.text, node: child })
          }
        }
      }
    }
    if (nonlocalVars.length === 0) return null

    // Collect all names defined in enclosing function scopes
    const enclosingNames = new Set<string>()

    function collectEnclosingNames(n: import('tree-sitter').SyntaxNode): void {
      if (n.type === 'parameters') {
        for (const p of n.namedChildren) {
          if (p.type === 'identifier') enclosingNames.add(p.text)
          else if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
            const pname = p.childForFieldName('name')
            if (pname) enclosingNames.add(pname.text)
          }
        }
      }
      if (n.type === 'assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') enclosingNames.add(left.text)
      }
      // Don't recurse into nested function bodies (only their params)
      if (n.id !== node.id && n.type === 'function_definition') {
        const params = n.childForFieldName('parameters')
        if (params) collectEnclosingNames(params)
        return
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectEnclosingNames(child)
      }
    }

    // Walk enclosing function(s) — parent of current function_definition
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const parentParams = parent.childForFieldName('parameters')
        if (parentParams) collectEnclosingNames(parentParams)
        const parentBody = parent.childForFieldName('body')
        if (parentBody) {
          for (const stmt of parentBody.namedChildren) {
            if (stmt.type === 'expression_statement') {
              const expr = stmt.namedChildren[0]
              if (expr?.type === 'assignment') {
                const left = expr.childForFieldName('left')
                if (left?.type === 'identifier') enclosingNames.add(left.text)
              }
            }
          }
        }
        break
      }
      parent = parent.parent
    }

    // If we found no enclosing function, nonlocal is definitely invalid
    const hasEnclosingFunction = (() => {
      let p = node.parent
      while (p) {
        if (p.type === 'function_definition') return true
        p = p.parent
      }
      return false
    })()

    for (const { name, node: varNode } of nonlocalVars) {
      if (!hasEnclosingFunction || (enclosingNames.size > 0 && !enclosingNames.has(name))) {
        return makeViolation(
          this.ruleKey, varNode, filePath, 'high',
          'nonlocal without enclosing binding',
          `\`nonlocal ${name}\` — \`${name}\` is not defined in any enclosing function scope. This will raise a SyntaxError.`,
          sourceCode,
          `Define \`${name}\` in an enclosing function scope, or remove the \`nonlocal\` declaration.`,
        )
      }
    }
    return null
  },
}
