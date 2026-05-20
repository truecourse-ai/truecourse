import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Default-export names that conventionally describe the module's *role*
 * rather than mirroring its filename. Treating these as mismatches is a
 * false positive: `export default app` from `router.ts` or `export
 * default route` from a route module is idiomatic.
 */
const CONVENTIONAL_DEFAULT_NAMES = new Set([
  'app', 'router', 'route', 'handler', 'server', 'config', 'default', 'middleware', 'plugin',
])

export const filenameClassMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/filename-class-mismatch',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['export_statement'],
  visit(node, filePath, sourceCode) {
    // Look for: export default class ClassName {}
    // or: export default ClassName; (where ClassName is the default export)
    const isDefault = node.children.some((c) => c.text === 'default')
    if (!isDefault) return null

    // Get the class or identifier being exported
    let exportedName: string | null = null
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'class_declaration') {
        exportedName = child.childForFieldName('name')?.text ?? null
        break
      }
      if (child.type === 'identifier') {
        exportedName = child.text
        break
      }
    }

    if (!exportedName) return null

    // Skip config files — export default config is a standard convention
    if (/\.(config|rc)\.(ts|js|mjs|cjs)$/.test(filePath)) return null

    // Skip framework route modules — their filename encodes a URL path
    // (Remix flat-routes `users.$id._index.tsx`, Next.js `[id]/page.tsx`,
    // etc.) and never mirrors the component name.
    if (/[\\/]routes?[\\/]/.test(filePath)) return null

    // Extract filename without extension
    const fileBase = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
    if (!fileBase) return null

    // Skip index files — `index.ts` re-exports / barrel files conventionally
    // export a value with a different name.
    if (fileBase === 'index' || fileBase === 'index.d') return null

    // Skip filenames containing routing-convention characters (`.`, `$`,
    // `+`, `[`, `]`) — Remix/SvelteKit/Nuxt encode route paths in
    // filenames where a strict class-name match is impossible.
    if (/[.$+[\]]/.test(fileBase)) return null

    // Skip when the default export uses a conventional generic name.
    if (CONVENTIONAL_DEFAULT_NAMES.has(exportedName.toLowerCase())) return null

    // Normalize: compare case-insensitively and strip common suffixes
    const normalizeFileName = (s: string) => s.toLowerCase().replace(/[-_.]/g, '')
    const normFile = normalizeFileName(fileBase)
    const normClass = normalizeFileName(exportedName)

    if (normFile && normClass && normFile !== normClass) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Filename/export name mismatch',
        `Default export \`${exportedName}\` does not match filename \`${fileBase}\`. This makes imports confusing.`,
        sourceCode,
        `Rename the file to match the export name, or rename the export to \`${fileBase}\`.`,
      )
    }
    return null
  },
}
