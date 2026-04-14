import type { CodeRuleVisitor } from '../../../types.js'

export { quadraticListSummationVisitor } from './quadratic-list-summation.js'
export { strReplaceOverReSubVisitor } from './str-replace-over-re-sub.js'
export { unnecessaryIterableAllocationVisitor } from './unnecessary-iterable-allocation.js'
export { sortedForMinMaxVisitor } from './sorted-for-min-max.js'
export { listCompInAnyAllVisitor } from './list-comprehension-in-any-all.js'
export { unnecessaryListCastVisitor } from './unnecessary-list-cast.js'
export { incorrectDictIteratorVisitor } from './incorrect-dict-iterator.js'
export { tryExceptInLoopVisitor } from './try-except-in-loop.js'
export { manualListComprehensionVisitor } from './manual-list-comprehension.js'
export { torchDataloaderNumWorkersVisitor } from './torch-dataloader-num-workers.js'
export { missingSlotsInSubclassVisitor } from './missing-slots-in-subclass.js'
export { batchWritesInLoopVisitor } from './batch-writes-in-loop.js'
export { setMutationsInLoopVisitor } from './set-mutations-in-loop.js'
export { runtimeCastOverheadVisitor } from './runtime-cast-overhead.js'

import { quadraticListSummationVisitor } from './quadratic-list-summation.js'
import { strReplaceOverReSubVisitor } from './str-replace-over-re-sub.js'
import { unnecessaryIterableAllocationVisitor } from './unnecessary-iterable-allocation.js'
import { sortedForMinMaxVisitor } from './sorted-for-min-max.js'
import { listCompInAnyAllVisitor } from './list-comprehension-in-any-all.js'
import { unnecessaryListCastVisitor } from './unnecessary-list-cast.js'
import { incorrectDictIteratorVisitor } from './incorrect-dict-iterator.js'
import { tryExceptInLoopVisitor } from './try-except-in-loop.js'
import { manualListComprehensionVisitor } from './manual-list-comprehension.js'
import { torchDataloaderNumWorkersVisitor } from './torch-dataloader-num-workers.js'
import { missingSlotsInSubclassVisitor } from './missing-slots-in-subclass.js'
import { batchWritesInLoopVisitor } from './batch-writes-in-loop.js'
import { setMutationsInLoopVisitor } from './set-mutations-in-loop.js'
import { runtimeCastOverheadVisitor } from './runtime-cast-overhead.js'

export const PERFORMANCE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  quadraticListSummationVisitor,
  strReplaceOverReSubVisitor,
  unnecessaryIterableAllocationVisitor,
  sortedForMinMaxVisitor,
  listCompInAnyAllVisitor,
  unnecessaryListCastVisitor,
  incorrectDictIteratorVisitor,
  tryExceptInLoopVisitor,
  manualListComprehensionVisitor,
  torchDataloaderNumWorkersVisitor,
  missingSlotsInSubclassVisitor,
  batchWritesInLoopVisitor,
  setMutationsInLoopVisitor,
  runtimeCastOverheadVisitor,
]
