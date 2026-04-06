import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImportSelfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/import-self',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // Extract the module name from the file path
    const fileName = filePath.split('/').pop() ?? ''
    const moduleName = fileName.endsWith('.py') ? fileName.slice(0, -3) : fileName

    if (!moduleName) return null

    if (node.type === 'import_statement') {
      // import foo, bar
      for (const child of node.namedChildren) {
        const name = child.type === 'dotted_name' ? child.text : child.type === 'identifier' ? child.text : null
        if (name === moduleName) {
          return makeViolation(
            this.ruleKey, child, filePath, 'high',
            'Module imports itself',
            `\`import ${name}\` imports the current module \`${moduleName}\` — this causes import errors or infinite recursion.`,
            sourceCode,
            'Remove the self-import or rename the module.',
          )
        }
      }
    } else if (node.type === 'import_from_statement') {
      // from foo import bar
      const moduleNode = node.childForFieldName('module_name')
      if (moduleNode?.text === moduleName) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Module imports itself',
          `\`from ${moduleName} import ...\` imports from the current module — this causes circular import errors.`,
          sourceCode,
          'Remove the self-import or restructure the module.',
        )
      }
    }
    return null
  },
}
