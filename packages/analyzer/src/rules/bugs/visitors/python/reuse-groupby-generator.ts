import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonReuseGroupbyGeneratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/reuse-groupby-generator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Pattern: for key, group in groupby(...):
    //             for item in group:   (first use — OK)
    //         ...
    //         for item in group:       (second use — yields nothing)
    // We detect: variable unpacking with exactly 2 vars where the iterable is a groupby call
    const iterExpr = node.childForFieldName('right')
    if (!iterExpr) return null

    // Check if iterating over groupby(...)
    const isGroupbyCall = (n: import('web-tree-sitter').Node): boolean => {
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'groupby') return true
        if (fn?.type === 'attribute') {
          const attr = fn.childForFieldName('attribute')
          if (attr?.text === 'groupby') return true
        }
      }
      return false
    }
    if (!isGroupbyCall(iterExpr)) return null

    // Get the loop variable — should be a tuple (key, group)
    const loopVar = node.childForFieldName('left')
    if (!loopVar || loopVar.type !== 'pattern_list' && loopVar.type !== 'tuple_pattern') return null

    const vars = loopVar.namedChildren
    if (vars.length !== 2) return null
    const groupVarName = vars[1].text

    // Check if group variable is iterated multiple times in body
    const body = node.childForFieldName('body')
    if (!body) return null

    let usageCount = 0
    function countUsages(n: import('web-tree-sitter').Node): void {
      if (n.type === 'for_statement') {
        const iterRight = n.childForFieldName('right')
        if (iterRight?.type === 'identifier' && iterRight.text === groupVarName) {
          usageCount++
        }
      }
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        const args = n.childForFieldName('arguments')
        if (args) {
          for (const arg of args.namedChildren) {
            if (arg.type === 'identifier' && arg.text === groupVarName) usageCount++
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countUsages(child)
      }
    }
    countUsages(body)

    if (usageCount > 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Reuse of groupby generator',
        `The group iterator \`${groupVarName}\` from \`groupby\` is used ${usageCount} times — iterating it a second time yields nothing because it is a one-shot generator.`,
        sourceCode,
        `Convert the group to a list on first use: \`${groupVarName} = list(${groupVarName})\`.`,
      )
    }
    return null
  },
}
