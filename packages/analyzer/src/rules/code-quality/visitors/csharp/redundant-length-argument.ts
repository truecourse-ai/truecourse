import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SLICE_METHODS = new Set(['Substring', 'Slice'])

/** Strip an `argument` wrapper down to its single expression child. */
function argExpr(arg: SyntaxNode): SyntaxNode | null {
  if (arg.type !== 'argument') return null
  return arg.namedChildren.find((c) => c != null) ?? null
}

/**
 * `s.Substring(start, s.Length - start)` (or `Slice`) passes a length that
 * reaches exactly to the end of the string — the second argument is redundant
 * and easy to get wrong; the single-argument overload says the same thing
 * (CA1514). Detected purely syntactically: the length argument is
 * `<recv>.Length - <start>` where `<recv>` matches the slice receiver and
 * `<start>` matches the first argument's text.
 */
export const csharpRedundantLengthArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-length-argument',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (!SLICE_METHODS.has(fn.childForFieldName('name')?.text ?? '')) return null
    const receiver = fn.childForFieldName('expression')?.text
    if (!receiver) return null

    const argList = node.childForFieldName('arguments')
    const args = argList?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    if (args.length !== 2) return null

    const startArg = args[0]
    const lengthArg = args[1]
    if (!startArg || !lengthArg) return null

    const startText = argExpr(startArg)?.text
    const lengthExpr = argExpr(lengthArg)
    if (!startText || !lengthExpr || lengthExpr.type !== 'binary_expression') return null
    if (lengthExpr.childForFieldName('operator')?.text !== '-') return null

    const left = lengthExpr.childForFieldName('left')
    const right = lengthExpr.childForFieldName('right')
    // left must be `<receiver>.Length`, right must equal the start argument.
    if (left?.type !== 'member_access_expression') return null
    if (left.childForFieldName('name')?.text !== 'Length') return null
    if (left.childForFieldName('expression')?.text !== receiver) return null
    if (right?.text !== startText) return null

    return makeViolation(
      this.ruleKey, lengthArg, filePath, 'low',
      'Redundant length argument',
      `\`${receiver}.Length - ${startText}\` reaches exactly to the end — drop the length argument and let the single-argument overload run to the end (CA1514).`,
      sourceCode,
      'Remove the redundant length argument.',
    )
  },
}
