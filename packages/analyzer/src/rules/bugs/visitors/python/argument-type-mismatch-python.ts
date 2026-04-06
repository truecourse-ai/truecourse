import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Heuristic: detects function calls where the argument count doesn't match the
 * function definition visible in the same file. Ignores *args/**kwargs.
 */

function findFunctionDefs(root: SyntaxNode): Map<string, { minParams: number, maxParams: number, hasVarArgs: boolean }> {
  const defs = new Map<string, { minParams: number, maxParams: number, hasVarArgs: boolean }>()

  function walk(node: SyntaxNode) {
    if (node.type === 'function_definition') {
      const name = node.childForFieldName('name')
      const params = node.childForFieldName('parameters')
      if (name && params) {
        let hasVarArgs = false
        let required = 0
        let optional = 0

        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          if (p.type === 'list_splat_pattern' || p.type === 'dictionary_splat_pattern') {
            hasVarArgs = true
            continue
          }
          if (p.type === 'identifier' || p.type === 'typed_parameter') {
            required++
          } else if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
            optional++
          }
        }

        // Check if first param is self/cls (method)
        const firstParam = params.namedChildren.find((c) =>
          c.type === 'identifier' || c.type === 'typed_parameter'
        )
        const isSelfOrCls = firstParam && (firstParam.text === 'self' || firstParam.text === 'cls' ||
          (firstParam.type === 'typed_parameter' && firstParam.childForFieldName('name')?.text === 'self') ||
          (firstParam.type === 'typed_parameter' && firstParam.childForFieldName('name')?.text === 'cls'))

        // For methods, subtract self/cls from the count
        if (isSelfOrCls) {
          required = Math.max(0, required - 1)
        }

        defs.set(name.text, {
          minParams: required,
          maxParams: hasVarArgs ? Infinity : required + optional,
          hasVarArgs,
        })
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) walk(child)
    }
  }

  walk(root)
  return defs
}

export const pythonArgumentTypeMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/argument-type-mismatch-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Only simple function calls (not method calls like obj.method())
    if (func.type !== 'identifier') return null
    const funcName = func.text

    // Find the function definition in the same file
    const root = node.tree.rootNode
    const defs = findFunctionDefs(root)
    const def = defs.get(funcName)
    if (!def) return null

    // Count positional arguments (exclude keyword arguments and *args/*kwargs)
    const args = node.childForFieldName('arguments')
    if (!args) return null

    let positionalCount = 0
    let hasStarArgs = false
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg) continue
      if (arg.type === 'keyword_argument') continue
      if (arg.type === 'list_splat' || arg.type === 'dictionary_splat') {
        hasStarArgs = true
        continue
      }
      positionalCount++
    }

    // Can't check if caller uses *args or **kwargs
    if (hasStarArgs) return null

    if (positionalCount < def.minParams) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Argument count mismatch',
        `\`${funcName}()\` called with ${positionalCount} argument(s) but requires at least ${def.minParams}.`,
        sourceCode,
        `Pass the correct number of arguments to \`${funcName}()\`.`,
      )
    }

    if (positionalCount > def.maxParams) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Argument count mismatch',
        `\`${funcName}()\` called with ${positionalCount} argument(s) but accepts at most ${def.maxParams}.`,
        sourceCode,
        `Pass the correct number of arguments to \`${funcName}()\`.`,
      )
    }

    return null
  },
}
