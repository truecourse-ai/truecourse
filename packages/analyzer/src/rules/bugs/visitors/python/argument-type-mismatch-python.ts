import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Heuristic: detects function calls where the argument count doesn't match the
 * function definition visible in the same file. Ignores *args/**kwargs.
 */

function isMethod(node: SyntaxNode): boolean {
  // A function_definition is a method if it's inside a class_definition body
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'class_definition') return true
    if (current.type === 'function_definition') return false // nested function, not a method
    current = current.parent
  }
  return false
}

function findFunctionDefs(root: SyntaxNode): Map<string, { minParams: number, maxParams: number, hasVarArgs: boolean, isMethod: boolean }> {
  const defs = new Map<string, { minParams: number, maxParams: number, hasVarArgs: boolean, isMethod: boolean }>()

  function walk(node: SyntaxNode) {
    if (node.type === 'function_definition') {
      const name = node.childForFieldName('name')
      const params = node.childForFieldName('parameters')
      if (name && params) {
        let hasVarArgs = false
        let required = 0
        let optional = 0
        const methodDef = isMethod(node)

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
        const firstParamName = firstParam?.type === 'typed_parameter'
          ? firstParam.childForFieldName('name')?.text
          : firstParam?.text
        const isSelfOrCls = firstParamName === 'self' || firstParamName === 'cls'

        // For methods, subtract self/cls from the count
        if (isSelfOrCls) {
          required = Math.max(0, required - 1)
        }

        defs.set(name.text, {
          minParams: required,
          maxParams: hasVarArgs ? Infinity : required + optional,
          hasVarArgs,
          isMethod: methodDef,
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

    // Skip calls to methods — we only see the definition side and can't reliably
    // know if it's invoked as a method (obj.foo()) or directly (foo()) from here.
    if (def.isMethod) return null

    // Count positional arguments (exclude keyword arguments and *args/*kwargs)
    const args = node.childForFieldName('arguments')
    if (!args) return null

    let positionalCount = 0
    let keywordCount = 0
    let hasStarArgs = false
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg) continue
      if (arg.type === 'keyword_argument') {
        keywordCount++
        continue
      }
      if (arg.type === 'list_splat' || arg.type === 'dictionary_splat') {
        hasStarArgs = true
        continue
      }
      // Skip comments — tree-sitter includes inline comments as named children
      if (arg.type === 'comment') continue
      positionalCount++
    }

    // Can't check if caller uses *args or **kwargs
    if (hasStarArgs) return null

    // Keyword args fill parameter slots, so total supplied = positional + keyword
    const totalSupplied = positionalCount + keywordCount

    if (totalSupplied < def.minParams) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Argument count mismatch',
        `\`${funcName}()\` called with ${totalSupplied} argument(s) but requires at least ${def.minParams}.`,
        sourceCode,
        `Pass the correct number of arguments to \`${funcName}()\`.`,
      )
    }

    if (totalSupplied > def.maxParams) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Argument count mismatch',
        `\`${funcName}()\` called with ${totalSupplied} argument(s) but accepts at most ${def.maxParams}.`,
        sourceCode,
        `Pass the correct number of arguments to \`${funcName}()\`.`,
      )
    }

    return null
  },
}
