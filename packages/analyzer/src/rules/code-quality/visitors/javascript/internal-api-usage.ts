import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects usage of internal/private APIs of libraries.
 * Importing from paths that contain internal, _internal, private, _private,
 * or start with underscore in package paths.
 */
export const internalApiUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/internal-api-usage',
  languages: JS_LANGUAGES,
  nodeTypes: ['import_statement', 'call_expression'],
  visit(node, filePath, sourceCode) {
    let importPath: string | null = null

    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source')
      if (source) {
        importPath = source.text.slice(1, -1) // strip quotes
      }
    } else if (node.type === 'call_expression') {
      // require() calls
      const fn = node.childForFieldName('function')
      if (!fn || fn.text !== 'require') return null
      const args = node.childForFieldName('arguments')
      if (!args) return null
      const firstArg = args.namedChildren[0]
      if (!firstArg || firstArg.type !== 'string') return null
      importPath = firstArg.text.slice(1, -1)
    }

    if (!importPath) return null

    // Skip relative imports (project's own internal paths)
    if (importPath.startsWith('.') || importPath.startsWith('/')) return null

    // Check for internal/private path segments
    const segments = importPath.split('/')

    // Skip the package name itself (e.g., @scope/pkg or pkg)
    const startIdx = importPath.startsWith('@') ? 2 : 1
    const subPath = segments.slice(startIdx)

    for (const segment of subPath) {
      if (
        segment === 'internal' ||
        segment === '_internal' ||
        segment === 'private' ||
        segment === '_private' ||
        segment === '__private' ||
        (segment.startsWith('_') && segment !== '_') ||
        segment === 'dist' && subPath.indexOf(segment) < subPath.length - 1 // deep into dist
      ) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Internal API usage',
          `Importing from internal path '${importPath}' — internal APIs may change without notice and break your code.`,
          sourceCode,
          'Use the library\'s public API instead of importing from internal paths.',
        )
      }
    }

    return null
  },
}
