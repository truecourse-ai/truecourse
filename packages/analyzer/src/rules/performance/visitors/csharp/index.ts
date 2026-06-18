import type { CodeRuleVisitor } from '../../../types.js'

export { csharpRegexInLoopVisitor } from './regex-in-loop.js'
export { csharpSyncFsInRequestHandlerVisitor } from './sync-fs-in-request-handler.js'
export { csharpJsonParseInLoopVisitor } from './json-parse-in-loop.js'
export { csharpQuadraticListSummationVisitor } from './quadratic-list-summation.js'
export { csharpBatchWritesInLoopVisitor } from './batch-writes-in-loop.js'
export { csharpIncorrectDictIteratorVisitor } from './incorrect-dict-iterator.js'
export { csharpSortedForMinMaxVisitor } from './sorted-for-min-max.js'
export { csharpListCompInAnyAllVisitor } from './list-comprehension-in-any-all.js'
export { csharpUnnecessaryListCastVisitor } from './unnecessary-list-cast.js'
export { csharpUnnecessaryIterableAllocationVisitor } from './unnecessary-iterable-allocation.js'
export { csharpEventListenerNoRemoveVisitor } from './event-listener-no-remove.js'
export { csharpSetMutationsInLoopVisitor } from './set-mutations-in-loop.js'
export { csharpSetTimeoutNoStoreVisitor } from './settimeout-setinterval-no-clear.js'
export { csharpUnboundedArrayGrowthVisitor } from './unbounded-array-growth.js'
export { csharpSpreadInReduceVisitor } from './spread-in-reduce.js'
export { csharpStrReplaceOverReSubVisitor } from './str-replace-over-re-sub.js'

import { csharpRegexInLoopVisitor } from './regex-in-loop.js'
import { csharpSyncFsInRequestHandlerVisitor } from './sync-fs-in-request-handler.js'
import { csharpJsonParseInLoopVisitor } from './json-parse-in-loop.js'
import { csharpQuadraticListSummationVisitor } from './quadratic-list-summation.js'
import { csharpBatchWritesInLoopVisitor } from './batch-writes-in-loop.js'
import { csharpIncorrectDictIteratorVisitor } from './incorrect-dict-iterator.js'
import { csharpSortedForMinMaxVisitor } from './sorted-for-min-max.js'
import { csharpListCompInAnyAllVisitor } from './list-comprehension-in-any-all.js'
import { csharpUnnecessaryListCastVisitor } from './unnecessary-list-cast.js'
import { csharpUnnecessaryIterableAllocationVisitor } from './unnecessary-iterable-allocation.js'
import { csharpEventListenerNoRemoveVisitor } from './event-listener-no-remove.js'
import { csharpSetMutationsInLoopVisitor } from './set-mutations-in-loop.js'
import { csharpSetTimeoutNoStoreVisitor } from './settimeout-setinterval-no-clear.js'
import { csharpUnboundedArrayGrowthVisitor } from './unbounded-array-growth.js'
import { csharpSpreadInReduceVisitor } from './spread-in-reduce.js'
import { csharpStrReplaceOverReSubVisitor } from './str-replace-over-re-sub.js'

export const PERFORMANCE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpRegexInLoopVisitor,
  csharpSyncFsInRequestHandlerVisitor,
  csharpJsonParseInLoopVisitor,
  csharpQuadraticListSummationVisitor,
  csharpBatchWritesInLoopVisitor,
  csharpIncorrectDictIteratorVisitor,
  csharpSortedForMinMaxVisitor,
  csharpListCompInAnyAllVisitor,
  csharpUnnecessaryListCastVisitor,
  csharpUnnecessaryIterableAllocationVisitor,
  csharpEventListenerNoRemoveVisitor,
  csharpSetMutationsInLoopVisitor,
  csharpSetTimeoutNoStoreVisitor,
  csharpUnboundedArrayGrowthVisitor,
  csharpSpreadInReduceVisitor,
  csharpStrReplaceOverReSubVisitor,
]
