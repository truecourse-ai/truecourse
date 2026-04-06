/**
 * Code quality domain JavaScript/TypeScript visitors — re-exports all visitors
 * and assembles the combined array.
 */

import type { CodeRuleVisitor } from '../../../types.js'

import { accessorPairsVisitor } from './accessor-pairs.js'

export { accessorPairsVisitor }

export const CODE_QUALITY_JS_VISITORS: CodeRuleVisitor[] = [
  accessorPairsVisitor,
]
