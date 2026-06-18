import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpEnclosingClass } from './_helpers.js'

/**
 * `Console.WriteLine` is the legitimate output channel of console apps and
 * CLI tools, so a bare match would drown real findings in false positives.
 * The rule fires only when the file shows clear library/server signals:
 *   - the file uses ASP.NET Core or the Generic Host, or
 *   - `ILogger` already appears in the file (the code HAS a logger), or
 *   - the enclosing class is a Controller / Hub / BackgroundService.
 * Files with an entry point (Main / top-level statements) and test files
 * are always skipped.
 */

const SERVER_BASE_TYPES = /\b(Controller|ControllerBase|Hub|BackgroundService|IHostedService|PageModel|Middleware)\b/

function fileHasEntryPoint(root: SyntaxNode): boolean {
  if (root.namedChildren.some((c) => c?.type === 'global_statement')) return true
  let found = false
  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'method_declaration' && n.childForFieldName('name')?.text === 'Main') {
      found = true
      return
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const child = n.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(root)
  return found
}

export const csharpConsoleLogVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')?.text
    const method = fn.childForFieldName('name')?.text
    if (receiver !== 'Console' && receiver !== 'Console.Error' && receiver !== 'Console.Out') return null
    if (method !== 'WriteLine' && method !== 'Write') return null

    // Test files use console output for diagnostics.
    const fileName = filePath.split('/').pop() ?? ''
    if (/(?:tests?|fixture)\.cs$/i.test(fileName) || /(?:^|\.)(?:test|fixture)/i.test(fileName)) return null

    // Entry-point files are console apps — console output is the product.
    let root: SyntaxNode = node
    while (root.parent) root = root.parent
    if (fileHasEntryPoint(root)) return null

    const enclosingClass = getCSharpEnclosingClass(node)
    const baseList = enclosingClass?.namedChildren.find((c) => c?.type === 'base_list')?.text ?? ''
    const isServerClass = SERVER_BASE_TYPES.test(baseList)
    const usesAspNet = sourceCode.includes('Microsoft.AspNetCore') || sourceCode.includes('Microsoft.Extensions.Hosting')
    const hasLogger = /\bILogger\b|\bILogger</.test(sourceCode)

    if (!isServerClass && !usesAspNet && !hasLogger) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Console.${method} call`,
      `\`Console.${method}\` in library/server code bypasses the logging pipeline — use \`ILogger\` so output gets levels, scopes, and sinks.`,
      sourceCode,
      'Replace the Console call with an injected ILogger<T> (e.g. `_logger.LogInformation(...)`).',
    )
  },
}
