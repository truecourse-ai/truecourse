import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: class MyModel(nn.Module) without calling super().__init__() in __init__

function extendsNNModule(classNode: SyntaxNode): boolean {
  const superclasses = classNode.childForFieldName('superclasses')
  if (!superclasses) return false
  const text = superclasses.text
  return (
    text.includes('nn.Module') ||
    text.includes('torch.nn.Module') ||
    text === 'Module'
  )
}

function hasInitMethod(classBody: SyntaxNode): SyntaxNode | null {
  for (const child of classBody.namedChildren) {
    if (child.type === 'function_definition') {
      const name = child.childForFieldName('name')
      if (name?.text === '__init__') return child
    }
    // Handle decorated functions
    if (child.type === 'decorated_definition') {
      for (const subchild of child.namedChildren) {
        if (subchild.type === 'function_definition') {
          const name = subchild.childForFieldName('name')
          if (name?.text === '__init__') return subchild
        }
      }
    }
  }
  return null
}

function callsSuperInit(initBody: SyntaxNode): boolean {
  let found = false
  function walk(n: SyntaxNode) {
    if (found) return
    if (n.type === 'call') {
      const fn = n.childForFieldName('function')
      if (!fn) return
      // super().__init__() pattern
      if (fn.type === 'attribute') {
        const obj = fn.childForFieldName('object')
        const attr = fn.childForFieldName('attribute')
        if (attr?.text === '__init__') {
          // Check if obj is super() call or super
          if (obj?.type === 'call') {
            const superFn = obj.childForFieldName('function')
            if (superFn?.text === 'super') { found = true; return }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(initBody)
  return found
}

export const pythonPytorchNnModuleMissingSuperVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pytorch-nn-module-missing-super',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!extendsNNModule(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const initMethod = hasInitMethod(body)
    if (!initMethod) return null // No __init__ defined

    const initBody = initMethod.childForFieldName('body')
    if (!initBody) return null

    if (!callsSuperInit(initBody)) {
      const nameNode = node.childForFieldName('name')
      return makeViolation(
        this.ruleKey, nameNode ?? node, filePath, 'high',
        'PyTorch nn.Module missing super().__init__',
        `\`${nameNode?.text ?? 'class'}\` extends \`nn.Module\` but \`__init__\` doesn't call \`super().__init__()\` — PyTorch module initialization will be incomplete.`,
        sourceCode,
        'Add `super().__init__()` at the beginning of `__init__`.',
      )
    }
    return null
  },
}
