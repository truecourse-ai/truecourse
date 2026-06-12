import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import {
  getCallArgs,
  getCreatedTypeName,
  getInitializerAssignments,
  isPlainStringLiteral,
  lastSegment,
  staticStringText,
} from './_helpers.js'

/**
 * Glob wildcard inside a shell command string handed to Process.Start /
 * ProcessStartInfo — `sh -c "rm -rf *"`-style commands let attacker-named
 * files become extra arguments. Only fires in a shell context (shell
 * executable or /c, -c pass-through flags) so `Arguments = "--filter *.log"`
 * for a non-shell tool stays clean.
 */
const SHELL_FILENAMES = /^(?:.*[\\/])?(?:cmd(?:\.exe)?|sh|bash|zsh|dash|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i
const SHELL_FLAG_PREFIX = /^\s*\/c\b/i
const WILDCARD_TOKEN = /(?:^|[\s"'=])\S*\*/

function shellCommandLiteral(node: SyntaxNode): string | null {
  if (!isPlainStringLiteral(node)) return null
  return staticStringText(node)
}

export const csharpWildcardInOsCommandVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/wildcard-in-os-command',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let command: string | null = null

    if (node.type === 'invocation_expression') {
      if (getCSharpMethodName(node) !== 'Start' || lastSegment(getCSharpReceiver(node)) !== 'Process') return null
      const args = getCallArgs(node)
      if (args.length < 2) return null
      const file = shellCommandLiteral(args[0]!.value)
      if (!file || !SHELL_FILENAMES.test(file.trim())) return null
      command = shellCommandLiteral(args[1]!.value)
    } else {
      if (getCreatedTypeName(node) !== 'ProcessStartInfo') return null
      const props = getInitializerAssignments(node)
      const fileName = props.find((p) => p.name === 'FileName')?.value
      const argumentsValue = props.find((p) => p.name === 'Arguments')?.value
      if (!argumentsValue) return null
      const argText = shellCommandLiteral(argumentsValue)
      if (!argText) return null
      const fileText = fileName ? shellCommandLiteral(fileName) : null
      const isShell = (fileText && SHELL_FILENAMES.test(fileText.trim())) || SHELL_FLAG_PREFIX.test(argText)
      if (!isShell) return null
      command = argText
    }

    if (!command || !WILDCARD_TOKEN.test(command)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Wildcard in OS command',
      `Shell command "${command.trim()}" contains a glob wildcard (*). Specially named files can be injected as extra arguments.`,
      sourceCode,
      'Enumerate files explicitly (Directory.EnumerateFiles) instead of passing shell wildcards.',
    )
  },
}
