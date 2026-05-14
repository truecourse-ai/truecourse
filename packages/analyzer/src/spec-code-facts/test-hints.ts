import ts from 'typescript'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { calleeParts, pushFact, rangeOf, stringLiteralValue } from './utils.js'

function isTestCallName(node: ts.Expression): { kind: 'describe' | 'test' } | null {
  const parts = calleeParts(node)
  const base = parts[0]
  if (base === 'describe') return { kind: 'describe' }
  if (base === 'it' || base === 'test') return { kind: 'test' }
  return null
}

function collectStringReferences(node: ts.Node): string[] {
  const refs = new Set<string>()
  const visit = (child: ts.Node): void => {
    if (ts.isStringLiteralLike(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
      const text = child.text.trim()
      if (text) refs.add(text)
    }
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  return [...refs].sort()
}

export function extractTestFacts(unit: SourceUnit): void {
  const suitePath: string[] = []

  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit)
      return
    }

    const testCall = isTestCallName(node.expression)
    const name = stringLiteralValue(node.arguments[0])
    if (!testCall || !name) {
      ts.forEachChild(node, visit)
      return
    }

    if (testCall.kind === 'describe') {
      suitePath.push(name)
      for (const arg of node.arguments.slice(1)) ts.forEachChild(arg, visit)
      suitePath.pop()
      return
    }

    const body = node.arguments[1]
    const currentSuite = [...suitePath]
    pushFact(
      unit.facts,
      unit.sourceFile,
      rangeOf(unit.ast, node),
      'test.case',
      'test.named',
      {
        name,
        fullName: [...currentSuite, name].join(' > '),
        suitePath: currentSuite,
        stringReferences: body ? collectStringReferences(body).filter((ref) => ref !== name) : [],
      },
      EXTRACTORS.testHint,
    )
  }

  visit(unit.ast)
}
