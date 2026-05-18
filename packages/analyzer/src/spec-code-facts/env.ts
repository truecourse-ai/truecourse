import ts from 'typescript'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { pushFact, rangeOf, stringLiteralValue } from './utils.js'

export function extractEnvFacts(unit: SourceUnit): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'process'
      && node.expression.name.text === 'env'
    ) {
      pushFact(
        unit.facts,
        unit.sourceFile,
        rangeOf(unit.ast, node),
        'config.env',
        'env.read',
        { name: node.name.text, access: 'dot' },
        EXTRACTORS.env,
      )
    }

    if (
      ts.isElementAccessExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'process'
      && node.expression.name.text === 'env'
    ) {
      const name = stringLiteralValue(node.argumentExpression)
      if (name) {
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, node),
          'config.env',
          'env.read',
          { name, access: 'bracket' },
          EXTRACTORS.env,
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
}
