import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const processExitInLibraryVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/process-exit-in-library',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'process' || prop?.text !== 'exit') return null

    // Files with a Node entry-point guard (`require.main === module`) or an ESM
    // `import.meta.main` check are runnable scripts, not library modules —
    // process.exit is the conventional way they terminate, regardless of the
    // file's name.
    if (/require\.main\s*===?\s*module|module\s*===?\s*require\.main|import\.meta\.main/.test(sourceCode)) {
      return null
    }

    // Allow in files that look like entry points
    const lowerPath = filePath.toLowerCase()
    if (
      lowerPath.includes('index.') ||
      lowerPath.includes('main.') ||
      lowerPath.includes('cli.') ||
      lowerPath.includes('bin/') ||
      lowerPath.includes('scripts/') ||
      lowerPath.includes('server.') ||
      lowerPath.includes('app.') ||
      lowerPath.endsWith('/worker.ts') || lowerPath.endsWith('/worker.js') ||
      lowerPath.includes('entrypoint.') ||
      // Seed scripts (`packages/prisma/seed-database.ts`, `prisma/seed.ts`,
      // `seeds/initial.ts`) are CLI entrypoints invoked by the framework
      // (Prisma's `prisma db seed`, custom seed runners) — process.exit is
      // the conventional way they terminate after running.
      /(?:^|\/)seeds?(?:[-.\/]|$)/.test(lowerPath) ||
      // Example scripts (`packages/api/v1/examples/*.ts`) are runnable demos,
      // not library code. They're executed as standalone scripts.
      lowerPath.includes('/examples/') ||
      // Migration scripts are one-shot entrypoints just like seeds.
      /(?:^|\/)migrations?(?:[-.\/]|$)/.test(lowerPath)
    ) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'process.exit() in non-entry-point code',
      'process.exit() terminates the entire process. Library code should throw errors instead.',
      sourceCode,
      'Throw an error instead of calling process.exit(), and let the caller decide how to handle it.',
    )
  },
}
