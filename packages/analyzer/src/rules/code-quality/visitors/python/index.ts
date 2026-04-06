/**
 * Code quality domain Python visitors — re-exports all visitors
 * and assembles the combined array.
 */

import type { CodeRuleVisitor } from '../../../types.js'

import { pythonAbstractClassWithoutAbstractMethodVisitor } from './abstract-class-without-abstract-method.js'

export { pythonAbstractClassWithoutAbstractMethodVisitor }

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonAbstractClassWithoutAbstractMethodVisitor,
]
