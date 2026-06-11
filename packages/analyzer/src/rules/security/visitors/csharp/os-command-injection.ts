import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import {
  assignmentTarget,
  dynamicStringParts,
  enclosingFunctionText,
  findRequestTaint,
  getCallArgs,
  getCreatedTypeName,
  getInitializerAssignments,
  isPlainStringLiteral,
  lastSegment,
  staticStringText,
} from './_helpers.js'

/**
 * Shell command execution built from dynamic strings:
 *   - Process.Start("cmd.exe"/"sh"/…, <interpolated or concatenated command>)
 *   - ProcessStartInfo { FileName = shell, Arguments = <dynamic> } or
 *     Arguments starting with the shell pass-through flags /C or -c
 *   - a dynamic FileName fed by request input (running a user-chosen binary)
 * Fixed argument strings and ArgumentList.Add(...) (no shell parsing) are
 * the safe idioms and never match.
 */
const SHELL_FILENAMES = /^(?:.*[\\/])?(?:cmd(?:\.exe)?|sh|bash|zsh|dash|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i
// cmd.exe's /C pass-through. The generic "-c" is NOT used here — tools like
// nginx/ssh take -c for non-shell flags and would false-positive.
const CMD_FLAG_PREFIX = /^\s*\/c\b/i
const SHELL_FILENAME_ASSIGNMENT = /FileName\s*=\s*[@$]?"(?:[^"]*[\\/])?(?:cmd(?:\.exe)?|sh|bash|zsh|dash|powershell(?:\.exe)?|pwsh(?:\.exe)?)"/i

function isShellLiteral(node: SyntaxNode): boolean {
  return isPlainStringLiteral(node) && SHELL_FILENAMES.test(staticStringText(node).trim())
}

function isProcessStartCall(node: SyntaxNode): boolean {
  if (getCSharpMethodName(node) !== 'Start') return false
  return lastSegment(getCSharpReceiver(node)) === 'Process'
}

export const csharpOsCommandInjectionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/os-command-injection',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    const flag = (detail: string) =>
      makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'OS command injection',
        detail,
        sourceCode,
        'Pass a fixed executable and use ProcessStartInfo.ArgumentList for values instead of building a shell command string.',
      )

    if (node.type === 'invocation_expression') {
      if (!isProcessStartCall(node)) return null
      const args = getCallArgs(node)
      // Process.Start(shell, dynamicCommand)
      if (args.length >= 2 && isShellLiteral(args[0]!.value) && dynamicStringParts(args[1]!.value)) {
        return flag('Process.Start() runs a shell with a command string built from dynamic input. This enables command injection.')
      }
      // Process.Start(dynamicFileName) where the file name comes from request input
      if (args.length >= 1) {
        const dynamic = dynamicStringParts(args[0]!.value)
        if (dynamic && dynamic.dynamicParts.some((p) => findRequestTaint(p))) {
          return flag('Process.Start() executable path is built from user-controlled input.')
        }
      }
      return null
    }

    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'ProcessStartInfo') return null
      const props = getInitializerAssignments(node)
      const ctorArgs = getCallArgs(node)
      const fileName = props.find((p) => p.name === 'FileName')?.value ?? ctorArgs[0]?.value ?? null
      const argumentsValue = props.find((p) => p.name === 'Arguments')?.value ?? ctorArgs[1]?.value ?? null

      if (argumentsValue) {
        const dynamic = dynamicStringParts(argumentsValue)
        if (dynamic) {
          if (fileName && isShellLiteral(fileName)) {
            return flag('ProcessStartInfo runs a shell with Arguments built from dynamic input. This enables command injection.')
          }
          // FileName set to a known non-shell tool → its flags are not shell pass-through.
          const fileNameIsNonShellLiteral = fileName !== null && isPlainStringLiteral(fileName) && !isShellLiteral(fileName)
          if (!fileNameIsNonShellLiteral && (CMD_FLAG_PREFIX.test(dynamic.staticText) || SHELL_FILENAME_ASSIGNMENT.test(enclosingFunctionText(node)))) {
            return flag('ProcessStartInfo.Arguments passes a dynamically built command through a shell. This enables command injection.')
          }
        }
      }
      if (fileName) {
        const dynamic = dynamicStringParts(fileName)
        if (dynamic && dynamic.dynamicParts.some((p) => findRequestTaint(p))) {
          return flag('ProcessStartInfo.FileName is built from user-controlled input.')
        }
      }
      return null
    }

    // psi.Arguments = <dynamic shell command> on a ProcessStartInfo variable.
    const target = assignmentTarget(node)
    if (!target || (target.name !== 'Arguments' && target.name !== 'FileName') || !target.receiver) return null
    if (!enclosingFunctionText(node).includes('ProcessStartInfo')) return null

    const dynamic = dynamicStringParts(target.value)
    if (!dynamic) return null
    if (target.name === 'Arguments' && (CMD_FLAG_PREFIX.test(dynamic.staticText) || SHELL_FILENAME_ASSIGNMENT.test(enclosingFunctionText(node)))) {
      return flag('ProcessStartInfo.Arguments passes a dynamically built command through a shell. This enables command injection.')
    }
    if (target.name === 'FileName' && dynamic.dynamicParts.some((p) => findRequestTaint(p))) {
      return flag('ProcessStartInfo.FileName is built from user-controlled input.')
    }
    return null
  },
}
