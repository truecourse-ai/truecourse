import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUndefinedExportVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/undefined-export',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Find __all__ = [...] assignment at the top level
    let allList: import('web-tree-sitter').Node | null = null
    const definedNames = new Set<string>()

    for (const child of node.namedChildren) {
      // Collect defined names: function defs, class defs, imports, assignments
      if (child.type === 'function_definition') {
        const name = child.childForFieldName('name')
        if (name) definedNames.add(name.text)
      }
      if (child.type === 'class_definition') {
        const name = child.childForFieldName('name')
        if (name) definedNames.add(name.text)
      }
      if (child.type === 'import_statement' || child.type === 'import_from_statement') {
        // Collect imported names
        for (const importChild of child.namedChildren) {
          if (importChild.type === 'dotted_name' || importChild.type === 'identifier') {
            definedNames.add(importChild.text)
          }
          if (importChild.type === 'aliased_import') {
            const alias = importChild.childForFieldName('alias')
            if (alias) definedNames.add(alias.text)
          }
        }
      }
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr) continue
        if (expr.type === 'assignment') {
          const left = expr.childForFieldName('left')
          const right = expr.childForFieldName('right')
          if (left?.text === '__all__' && right?.type === 'list') {
            allList = right
          } else if (left?.type === 'identifier') {
            definedNames.add(left.text)
          }
        }
      }
      if (child.type === 'decorated_definition') {
        const inner = child.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'class_definition')
        if (inner) {
          const name = inner.childForFieldName('name')
          if (name) definedNames.add(name.text)
        }
      }
    }

    if (!allList) return null

    for (const item of allList.namedChildren) {
      if (item.type === 'string') {
        const exportName = item.text.slice(1, -1) // strip quotes
        if (exportName && !definedNames.has(exportName)) {
          return makeViolation(
            this.ruleKey, item, filePath, 'high',
            'Undefined name in __all__',
            `\`"${exportName}"\` is listed in \`__all__\` but is not defined in this module — importing it will raise an AttributeError.`,
            sourceCode,
            `Define \`${exportName}\` in this module or remove it from \`__all__\`.`,
          )
        }
      }
    }

    return null
  },
}
