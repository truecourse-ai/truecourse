import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, lastSegment } from './_helpers.js'

/**
 * PBKDF2 (`new Rfc2898DeriveBytes(password, salt, iterations)` or the static
 * `Rfc2898DeriveBytes.Pbkdf2(...)`) configured with an iteration count below
 * the recommended floor. A low iteration count weakens resistance to offline
 * dictionary attacks.
 */
const MIN_ITERATIONS = 100_000

function parseIntLiteral(node: SyntaxNode | undefined): number | null {
  if (!node || node.type !== 'integer_literal') return null
  const value = Number(node.text.replace(/_/g, '').replace(/[uUlL]+$/, ''))
  return Number.isFinite(value) ? value : null
}

/** The iterations argument: named `iterations`, else the 3rd positional (ctor) / 4th (Pbkdf2). */
function iterationsArg(node: SyntaxNode, positionalIndex: number): SyntaxNode | undefined {
  const args = getCallArgs(node)
  const named = args.find((a) => a.name === 'iterations')
  if (named) return named.value
  const positional = args.filter((a) => a.name === null)
  return positional[positionalIndex]?.value
}

export const csharpKdfLowIterationCountVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/kdf-low-iteration-count',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    let arg: SyntaxNode | undefined
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type') ?? node.namedChildren[0]
      if (lastSegment(type?.text ?? '') !== 'Rfc2898DeriveBytes') return null
      arg = iterationsArg(node, 2)
    } else {
      if (getCSharpMethodName(node) !== 'Pbkdf2') return null
      const recv = lastSegment(getCSharpReceiver(node))
      if (recv !== 'Rfc2898DeriveBytes') return null
      arg = iterationsArg(node, 3)
    }

    const iterations = parseIntLiteral(arg)
    if (iterations === null || iterations >= MIN_ITERATIONS) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Key-derivation iteration count too low',
      `PBKDF2 is configured with ${iterations} iterations, below the recommended ${MIN_ITERATIONS.toLocaleString()}, weakening resistance to offline dictionary attacks.`,
      sourceCode,
      `Use at least ${MIN_ITERATIONS.toLocaleString()} iterations (or a memory-hard KDF such as Argon2).`,
    )
  },
}
