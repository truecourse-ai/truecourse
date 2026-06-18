import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { enclosingFunctionText, getCallArgs } from './_helpers.js'

/**
 * Zip-slip: `entry.ExtractToFile(Path.Combine(dest, entry.FullName))` —
 * archive entry names containing `../` escape the destination directory.
 * `ZipFile.ExtractToDirectory()` (framework-validated) and extractions
 * guarded by a GetFullPath/StartsWith containment check are safe.
 */
export const csharpUnsafeUnzipVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-unzip',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'ExtractToFile') return null

    const usesEntryName = getCallArgs(node).some((a) => /\.\s*FullName\b|\.\s*Name\b/.test(a.value.text))
    if (!usesEntryName) return null

    if (/\bStartsWith\s*\(/.test(enclosingFunctionText(node))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe archive extraction',
      'ExtractToFile() destination is built from the archive entry name. Entries containing "../" escape the target directory (zip slip).',
      sourceCode,
      'Resolve the destination with Path.GetFullPath() and verify it StartsWith the extraction root — or use ZipFile.ExtractToDirectory().',
    )
  },
}
