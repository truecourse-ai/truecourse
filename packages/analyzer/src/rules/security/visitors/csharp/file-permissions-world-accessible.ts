import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { assignmentTarget, getCallArgs, lastSegment } from './_helpers.js'

/**
 * World-writable permissions: UnixFileMode flag sets including OtherWrite
 * passed to File.SetUnixFileMode() or assigned to UnixCreateMode
 * (FileStreamOptions). World-readable (OtherRead, 644-style) is normal and
 * not flagged.
 */
const WORLD_WRITABLE = /\bUnixFileMode\s*\.\s*OtherWrite\b/

export const csharpFilePermissionsWorldAccessibleVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/file-permissions-world-accessible',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'invocation_expression') {
      if (getCSharpMethodName(node) !== 'SetUnixFileMode' || lastSegment(getCSharpReceiver(node)) !== 'File') return null
      const modeArg = getCallArgs(node).find((a) => WORLD_WRITABLE.test(a.value.text))
      if (!modeArg) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'World-accessible file permissions',
        'File.SetUnixFileMode() grants OtherWrite — any local user can modify the file.',
        sourceCode,
        'Drop UnixFileMode.OtherWrite; use owner/group permissions (e.g. UserRead | UserWrite | GroupRead).',
      )
    }

    const target = assignmentTarget(node)
    if (!target || target.name !== 'UnixCreateMode' || !WORLD_WRITABLE.test(target.value.text)) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'World-accessible file permissions',
      'UnixCreateMode grants OtherWrite — any local user can modify the created file.',
      sourceCode,
      'Drop UnixFileMode.OtherWrite from the create mode.',
    )
  },
}
