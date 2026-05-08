import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Filename suffixes that signal the file's role rather than its identity
// (.api, .service, .controller, etc). They should be stripped before
// comparing the filename to the exported name. `auth-service.api.ts`
// declaring `class AuthService` matches once the `.api` is stripped.
const FILENAME_TYPE_SUFFIXES = [
  '.api', '.service', '.client', '.controller', '.handler', '.middleware',
  '.module', '.component', '.container', '.page', '.view', '.layout',
  '.hook', '.hooks', '.context', '.provider', '.store', '.reducer',
  '.actions', '.types', '.constants', '.config', '.utils', '.helpers',
  '.spec', '.test', '.e2e', '.stories', '.fixtures', '.mock', '.mocks',
  '.schema', '.dto', '.entity', '.model', '.repository', '.dao',
]

// Collect identifiers brought into scope by `import` statements. Default
// imports (`import X from 'p'`), namespace imports (`import * as X`),
// and named imports (`import { X, Y as Z }`) all introduce local names.
function collectImportedNames(programNode: SyntaxNode): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i < programNode.namedChildCount; i++) {
    const stmt = programNode.namedChild(i)
    if (!stmt || stmt.type !== 'import_statement') continue
    for (let j = 0; j < stmt.namedChildCount; j++) {
      const child = stmt.namedChild(j)
      if (!child) continue
      if (child.type === 'import_clause') {
        for (let k = 0; k < child.namedChildCount; k++) {
          const grand = child.namedChild(k)
          if (!grand) continue
          if (grand.type === 'identifier') {
            names.add(grand.text)
          } else if (grand.type === 'namespace_import') {
            const idNode = grand.namedChildren.find((c) => c.type === 'identifier')
            if (idNode) names.add(idNode.text)
          } else if (grand.type === 'named_imports') {
            for (let m = 0; m < grand.namedChildCount; m++) {
              const spec = grand.namedChild(m)
              if (!spec || spec.type !== 'import_specifier') continue
              const alias = spec.childForFieldName('alias') ?? spec.childForFieldName('name')
              if (alias?.type === 'identifier') names.add(alias.text)
            }
          }
        }
      }
    }
  }
  return names
}

// Class-name role suffixes that signal the export's role rather than its
// identity. `AuthService` in `auth.ts` is a service named "Auth"; the
// `Service` part is the role. Strip these from the EXPORTED NAME before
// comparing so naming conventions like `*Client` / `*Screen` / `*Provider`
// don't trigger spurious mismatches.
// Sorted longest-first so compound suffixes (`EmailTemplate`) match before
// their shorter components (`Template`).
const CLASS_ROLE_SUFFIXES = [
  'EmailTemplate',
  'Service', 'Client', 'Component', 'Screen', 'View', 'Page',
  'Container', 'Provider', 'Context', 'Store', 'Reducer',
  'Manager', 'Handler', 'Controller', 'Middleware',
  'Repository', 'Model', 'Entity', 'Template',
  'Dao', 'Dto',
  'Helper', 'Helpers', 'Util', 'Utils',
  'Factory', 'Builder', 'Adapter', 'Wrapper',
].sort((a, b) => b.length - a.length)

// Generate candidate forms of the class name for filename comparison.
// Both shapes are common and only one is the right strip:
//   `AccessAuth2FAEmailTemplate` ↔ `access-auth-2fa.tsx`
//      → strip the compound `EmailTemplate` (the `Email` is part of "email
//        template" the kind, not the file's identity word).
//   `ConfirmEmailTemplate` ↔ `confirm-email.tsx`
//      → strip just `Template` (`Email` IS the file's identity word).
// We can't disambiguate a priori, so generate every reachable strip-state
// (BFS over all matching suffixes at every step) and let the caller
// declare a match if ANY form equals the filename.
function classNameCandidates(name: string): string[] {
  const seen = new Set<string>([name])
  const queue: string[] = [name]
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]
    for (const sfx of CLASS_ROLE_SUFFIXES) {
      if (current.length > sfx.length && current.endsWith(sfx)) {
        const stripped = current.slice(0, -sfx.length)
        if (!seen.has(stripped)) {
          seen.add(stripped)
          queue.push(stripped)
        }
      }
    }
  }
  return queue
}

function stripTypeSuffixes(fileBase: string): string {
  let stripped = fileBase
  // Strip suffixes repeatedly so `auth-service.api` → `auth-service` → `auth-service`.
  let changed = true
  while (changed) {
    changed = false
    for (const sfx of FILENAME_TYPE_SUFFIXES) {
      if (stripped.length > sfx.length && stripped.endsWith(sfx)) {
        stripped = stripped.slice(0, -sfx.length)
        changed = true
        break
      }
    }
  }
  return stripped
}

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
    let exportedFromDeclaration = false
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'class_declaration') {
        exportedName = child.childForFieldName('name')?.text ?? null
        exportedFromDeclaration = true
        break
      }
      if (child.type === 'identifier') {
        exportedName = child.text
        break
      }
    }

    if (!exportedName) return null

    // The rule is about CLASS / COMPONENT default exports — values whose
    // name is intended to mirror the filename. A lowercase identifier
    // (`route`, `app`, `loader`, `action`, `meta`, `handler`) is a
    // framework-convention name (Remix/Next.js routes, Express apps,
    // tRPC procedures) where the variable name carries no identity —
    // the FILENAME is the identity. There is nothing to "rename to match"
    // because the variable name IS the convention.
    if (!/^[A-Z]/.test(exportedName)) return null

    // Skip config files — export default config is a standard convention
    if (/\.(config|rc)\.(ts|js|mjs|cjs)$/.test(filePath)) return null

    // Re-export of an imported identifier is not a class declaration in
    // this file. `import X from 'p'; export default X;` — there is no
    // class here whose name we can change to match the filename.
    if (!exportedFromDeclaration) {
      const programNode = node.parent
      if (programNode) {
        const imported = collectImportedNames(programNode)
        if (imported.has(exportedName)) return null
      }
    }

    // Extract filename without extension
    const fileBase = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''
    if (!fileBase) return null

    // Strip filename type-role suffixes (`.api`, `.service`, …) so
    // `auth-service.api.ts` → `auth-service` matches `AuthService`.
    const baseForCompare = stripTypeSuffixes(fileBase)

    // Normalize: compare case-insensitively and strip dashes/underscores/dots.
    const normalizeName = (s: string) => s.toLowerCase().replace(/[-_.]/g, '')
    const normFile = normalizeName(baseForCompare)
    if (!normFile) return null

    // Match if any candidate form of the class name equals the filename.
    // This covers both `UserService.ts` ↔ `UserService` (no strip needed)
    // and `api-keys.ts` ↔ `ApiKeysClient` (strip `Client`).
    const candidates = classNameCandidates(exportedName)
    for (const candidate of candidates) {
      if (normalizeName(candidate) === normFile) return null
    }

    // react-email convention: \`templates/document-rejected.tsx\`
    // exports \`DocumentRejectedEmail\`. Try the additional strip
    // of bare \`Email\` ONLY when the path indicates an email
    // template directory — otherwise the strip is too eager
    // (\`UserEmail\` is a user's email value, not a "User" template).
    if (/[\\/]emails?[\\/]templates?[\\/]|[\\/]templates?[\\/]emails?[\\/]/i.test(filePath) ||
        /[\\/]email[\\/]templates?[\\/]/i.test(filePath) ||
        /[\\/](?:emails?|email-templates?)[\\/]/i.test(filePath)) {
      for (const candidate of candidates) {
        if (candidate.endsWith('Email') && candidate.length > 5) {
          const stripped = candidate.slice(0, -5)
          if (normalizeName(stripped) === normFile) return null
        }
      }
    }

    const normClass = normalizeName(exportedName)
    if (normClass) {
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
