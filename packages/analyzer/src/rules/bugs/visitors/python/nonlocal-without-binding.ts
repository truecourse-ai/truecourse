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
    const nonlocalVars: Array<{ name: string; node: import('web-tree-sitter').Node }> = []
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

    function collectEnclosingNames(n: import('web-tree-sitter').Node): void {
      if (n.type === 'parameters') {
        for (const p of n.namedChildren) {
          if (p.type === 'identifier') enclosingNames.add(p.text)
          else if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
            const pname = p.childForFieldName('name')
            if (pname) enclosingNames.add(pname.text)
          } else if (p.type === 'typed_parameter') {
            // typed_parameter: name: type
            const pname = p.namedChildren.find((c) => c.type === 'identifier')
            if (pname) enclosingNames.add(pname.text)
          }
        }
      }
      if (n.type === 'assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') enclosingNames.add(left.text)
      }
      if (n.type === 'augmented_assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') enclosingNames.add(left.text)
      }
      // for-loop variable: `for x in items:`
      if (n.type === 'for_statement') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') enclosingNames.add(left.text)
      }
      // with-statement: `with open(f) as x:`
      if (n.type === 'as_pattern') {
        const alias = n.namedChildren.find((c) => c.type === 'as_pattern_target')
        if (alias) {
          const id = alias.namedChildren.find((c) => c.type === 'identifier')
          if (id) enclosingNames.add(id.text)
        }
      }
      // Don't recurse into any nested function body — including the
      // current function being analyzed (`node`). We only collect params
      // of nested functions (they're still in the enclosing scope).
      if (n.type === 'function_definition') {
        const params = n.childForFieldName('parameters')
        if (params) collectEnclosingNames(params)
        return
      }
      // Don't recurse into class definitions
      if (n.type === 'class_definition') return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectEnclosingNames(child)
      }
    }

    // Walk enclosing function(s) — parent of current function_definition.
    // Use `collectEnclosingNames` which recursively walks assignments,
    // for-loop variables, with-statement bindings, etc.
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const parentParams = parent.childForFieldName('parameters')
        if (parentParams) collectEnclosingNames(parentParams)
        const parentBody = parent.childForFieldName('body')
        if (parentBody) collectEnclosingNames(parentBody)
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
      if (!hasEnclosingFunction || !enclosingNames.has(name)) {
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
