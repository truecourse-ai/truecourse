import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Seed / database-bootstrap scripts run once during setup, are
// intentionally sequential, and are not on any hot path. Treat any file
// whose path contains a `seed/`/`seeds/` directory segment, or whose
// basename matches `seed*.ts` / `*-seed.ts` / `*-seeds.ts`, as out of
// scope for this rule.
const SEED_FILE_PATH_PATTERN = /(?:^|[\\/])(?:seed|seeds)[\\/]|(?:^|[\\/])seed[^\\/]*\.(?:ts|tsx|js|jsx|mjs|cjs)$|[-_.](?:seed|seeds)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i

function isInSeedScript(filePath: string): boolean {
  return SEED_FILE_PATH_PATTERN.test(filePath)
}

// A `while`/`do-while` whose condition steps through a chain via optional
// chaining (`while (node?.parent)`) is a linked-list-style walk: each
// iteration depends on the awaited result of the previous one and can't
// be parallelised. Standard "drain an array" loops use `for-of` or a
// length test, not an optional-chained property access.
function isSerialChainWalk(loopNode: SyntaxNode): boolean {
  if (loopNode.type !== 'while_statement' && loopNode.type !== 'do_statement') {
    return false
  }
  const condition =
    loopNode.childForFieldName('condition') ?? loopNode.childForFieldName('test')
  if (!condition) return false
  return containsOptionalChain(condition)
}

function containsOptionalChain(node: SyntaxNode): boolean {
  if (node.type === 'optional_chain') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsOptionalChain(child)) return true
  }
  return false
}

export const awaitInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-in-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['await_expression'],
  visit(node, filePath, sourceCode) {
    if (isInSeedScript(filePath)) return null

    // Walk up the tree to find if we're inside a loop
    let current: SyntaxNode | null = node.parent
    while (current) {
      const t = current.type
      if (t === 'for_statement' || t === 'for_in_statement' || t === 'while_statement' || t === 'do_statement') {
        if (isSerialChainWalk(current)) return null
        // Make sure we're in the loop body (not the initializer/condition of a for loop)
        // and not inside a nested async function
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Await inside loop',
          '`await` inside a loop forces sequential execution of async operations. Consider collecting promises and using `Promise.all()` for parallel execution.',
          sourceCode,
          'Extract the async calls into an array and use `await Promise.all(promises)` outside the loop.',
        )
      }
      // Stop recursing if we hit a function boundary
      if (t === 'function_declaration' || t === 'arrow_function' || t === 'function' || t === 'method_definition') {
        break
      }
      current = current.parent
    }
    return null
  },
}
