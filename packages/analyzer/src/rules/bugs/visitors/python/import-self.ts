import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Check if an import name matches the current module.
 *
 * A bare `import requests` in `brain/api/requests.py` is NOT a self-import
 * because the full module path is `brain.api.requests`, not `requests`.
 * Only flag when the import name is a simple basename AND the file is a
 * top-level module (not inside a package), or when the dotted import path
 * matches the file's full module path.
 */
function isSelfImport(importName: string, filePath: string): boolean {
  const parts = filePath.replace(/\\/g, '/').split('/')
  const fileName = parts.pop() ?? ''
  const moduleName = fileName.endsWith('.py') ? fileName.slice(0, -3) : fileName

  if (!moduleName) return false

  // Simple name import (e.g. `import requests`)
  if (!importName.includes('.')) {
    // Only a self-import if the basename matches AND the file is NOT inside a package
    // (i.e., the parent directory does NOT contain an __init__.py, or we approximate
    //  by checking that the import path would need to be dotted for a packaged module).
    // A file like `brain/api/requests.py` has a package path `brain.api.requests`,
    // so `import requests` refers to the top-level `requests` package, not itself.
    if (importName !== moduleName) return false

    // If the file path contains directory segments that look like Python packages,
    // a bare import can't refer to this nested module — it refers to a top-level package.
    // Heuristic: if there's at least one directory component between project root markers
    // and the file, it's inside a package.
    const dirPath = parts.join('/')
    // Check if any parent dir is a Python package (has __init__.py sibling at same level)
    // We can't check the filesystem here, so use a simpler heuristic:
    // If the file path has more than one directory component after common root markers,
    // the module is nested and a bare import refers to a different (top-level) module.
    const pathDepthIndicators = ['site-packages', 'src', 'lib', 'venv', '.venv']
    const hasPackageStructure = dirPath.length > 0 && !pathDepthIndicators.some(m => {
      const idx = dirPath.lastIndexOf(m)
      if (idx === -1) return false
      const after = dirPath.slice(idx + m.length + 1)
      return !after.includes('/')
    })

    // If file is directly in a root-like dir, it IS a self-import
    // If file has package nesting (subdir/file.py), bare import targets a different module
    if (hasPackageStructure) return false

    return true
  }

  // Dotted import (e.g. `import brain.api.requests` or `from brain.api.requests import ...`)
  // Build the full module path from the file path and compare
  // Walk backwards collecting package segments
  const moduleSegments = [moduleName]
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts[i]
    if (!dir || dir === '.' || dir === '..') break
    // Stop at common project-root markers
    if (['site-packages', 'src', 'lib', 'dist', 'venv', '.venv', 'node_modules'].includes(dir)) break
    moduleSegments.unshift(dir)
  }

  const fullModulePath = moduleSegments.join('.')
  return importName === fullModulePath
}

export const pythonImportSelfVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/import-self',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    const fileName = filePath.split('/').pop() ?? ''
    const moduleName = fileName.endsWith('.py') ? fileName.slice(0, -3) : fileName

    if (!moduleName) return null

    if (node.type === 'import_statement') {
      // import foo, bar
      for (const child of node.namedChildren) {
        const name = child.type === 'dotted_name' ? child.text : child.type === 'identifier' ? child.text : null
        if (name && isSelfImport(name, filePath)) {
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
      if (moduleNode && isSelfImport(moduleNode.text, filePath)) {
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
