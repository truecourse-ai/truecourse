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
export { csharpExplicitGcCollectVisitor } from './explicit-gc-collect.js'
export { csharpGetExecutingAssemblyVisitor } from './get-executing-assembly.js'
export { csharpZeroLengthArrayAllocationVisitor } from './zero-length-array-allocation.js'
export { csharpMultidimensionalArrayVisitor } from './multidimensional-array.js'
export { csharpWhenAllSingleTaskVisitor } from './whenall-single-task.js'
export { csharpWaitAllSingleTaskVisitor } from './waitall-single-task.js'
export { csharpUseCurrentManagedThreadIdVisitor } from './use-currentmanagedthreadid.js'
export { csharpUseEnvironmentProcessIdVisitor } from './use-environment-processid.js'
export { csharpUseEnvironmentProcessPathVisitor } from './use-environment-processpath.js'
export { csharpNestedPathCombineVisitor } from './nested-path-combine.js'
export { csharpPreferRegexIsMatchVisitor } from './prefer-regex-ismatch.js'
export { csharpPreferRegexCountVisitor } from './prefer-regex-count.js'
export { csharpJsonDocumentRootElementVisitor } from './jsondocument-rootelement.js'
export { csharpRedundantContainsKeyBeforeRemoveVisitor } from './redundant-containskey-before-remove.js'
export { csharpPreferTryAddVisitor } from './prefer-tryadd.js'
export { csharpToLowerForComparisonVisitor } from './tolower-for-comparison.js'
export { csharpUseToHexStringVisitor } from './use-tohexstring.js'
export { csharpLocalJsonSerializerOptionsVisitor } from './local-jsonserializeroptions.js'
export { csharpFilterBeforeSortVisitor } from './filter-before-sort.js'
export { csharpCountAsyncInsteadOfAnyAsyncVisitor } from './countasync-instead-of-anyasync.js'
export { csharpPreferContainsOverAnyVisitor } from './prefer-contains-over-any.js'
export { csharpPreferCharStartsWithEndsWithVisitor } from './prefer-char-startswith-endswith.js'
export { csharpStringBuilderAppendSingleCharStringVisitor } from './stringbuilder-append-single-char-string.js'
export { csharpStringBuilderToStringAppendVisitor } from './stringbuilder-tostring-append.js'
export { csharpRedundantStringBuilderToStringVisitor } from './redundant-stringbuilder-tostring.js'
export { csharpSpanFillDefaultOverClearVisitor } from './span-fill-default-over-clear.js'
export { csharpPreferTryGetValueVisitor } from './prefer-trygetvalue.js'
export { csharpStringBuilderPinvokeParameterVisitor } from './stringbuilder-pinvoke-parameter.js'
export { csharpPropertyReturnsCollectionCopyVisitor } from './property-returns-collection-copy.js'
export { csharpConstantArrayArgumentVisitor } from './constant-array-argument.js'

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
import { csharpExplicitGcCollectVisitor } from './explicit-gc-collect.js'
import { csharpGetExecutingAssemblyVisitor } from './get-executing-assembly.js'
import { csharpZeroLengthArrayAllocationVisitor } from './zero-length-array-allocation.js'
import { csharpMultidimensionalArrayVisitor } from './multidimensional-array.js'
import { csharpWhenAllSingleTaskVisitor } from './whenall-single-task.js'
import { csharpWaitAllSingleTaskVisitor } from './waitall-single-task.js'
import { csharpUseCurrentManagedThreadIdVisitor } from './use-currentmanagedthreadid.js'
import { csharpUseEnvironmentProcessIdVisitor } from './use-environment-processid.js'
import { csharpUseEnvironmentProcessPathVisitor } from './use-environment-processpath.js'
import { csharpNestedPathCombineVisitor } from './nested-path-combine.js'
import { csharpPreferRegexIsMatchVisitor } from './prefer-regex-ismatch.js'
import { csharpPreferRegexCountVisitor } from './prefer-regex-count.js'
import { csharpJsonDocumentRootElementVisitor } from './jsondocument-rootelement.js'
import { csharpRedundantContainsKeyBeforeRemoveVisitor } from './redundant-containskey-before-remove.js'
import { csharpPreferTryAddVisitor } from './prefer-tryadd.js'
import { csharpToLowerForComparisonVisitor } from './tolower-for-comparison.js'
import { csharpUseToHexStringVisitor } from './use-tohexstring.js'
import { csharpLocalJsonSerializerOptionsVisitor } from './local-jsonserializeroptions.js'
import { csharpFilterBeforeSortVisitor } from './filter-before-sort.js'
import { csharpCountAsyncInsteadOfAnyAsyncVisitor } from './countasync-instead-of-anyasync.js'
import { csharpPreferContainsOverAnyVisitor } from './prefer-contains-over-any.js'
import { csharpPreferCharStartsWithEndsWithVisitor } from './prefer-char-startswith-endswith.js'
import { csharpStringBuilderAppendSingleCharStringVisitor } from './stringbuilder-append-single-char-string.js'
import { csharpStringBuilderToStringAppendVisitor } from './stringbuilder-tostring-append.js'
import { csharpRedundantStringBuilderToStringVisitor } from './redundant-stringbuilder-tostring.js'
import { csharpSpanFillDefaultOverClearVisitor } from './span-fill-default-over-clear.js'
import { csharpPreferTryGetValueVisitor } from './prefer-trygetvalue.js'
import { csharpStringBuilderPinvokeParameterVisitor } from './stringbuilder-pinvoke-parameter.js'
import { csharpPropertyReturnsCollectionCopyVisitor } from './property-returns-collection-copy.js'
import { csharpConstantArrayArgumentVisitor } from './constant-array-argument.js'

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
  csharpExplicitGcCollectVisitor,
  csharpGetExecutingAssemblyVisitor,
  csharpZeroLengthArrayAllocationVisitor,
  csharpMultidimensionalArrayVisitor,
  csharpWhenAllSingleTaskVisitor,
  csharpWaitAllSingleTaskVisitor,
  csharpUseCurrentManagedThreadIdVisitor,
  csharpUseEnvironmentProcessIdVisitor,
  csharpUseEnvironmentProcessPathVisitor,
  csharpNestedPathCombineVisitor,
  csharpPreferRegexIsMatchVisitor,
  csharpPreferRegexCountVisitor,
  csharpJsonDocumentRootElementVisitor,
  csharpRedundantContainsKeyBeforeRemoveVisitor,
  csharpPreferTryAddVisitor,
  csharpToLowerForComparisonVisitor,
  csharpUseToHexStringVisitor,
  csharpLocalJsonSerializerOptionsVisitor,
  csharpFilterBeforeSortVisitor,
  csharpCountAsyncInsteadOfAnyAsyncVisitor,
  csharpPreferContainsOverAnyVisitor,
  csharpPreferCharStartsWithEndsWithVisitor,
  csharpStringBuilderAppendSingleCharStringVisitor,
  csharpStringBuilderToStringAppendVisitor,
  csharpRedundantStringBuilderToStringVisitor,
  csharpSpanFillDefaultOverClearVisitor,
  csharpPreferTryGetValueVisitor,
  csharpStringBuilderPinvokeParameterVisitor,
  csharpPropertyReturnsCollectionCopyVisitor,
  csharpConstantArrayArgumentVisitor,
]
