import type { CodeRuleVisitor } from '../../../types.js'

import { csharpEmptyCatchVisitor } from './empty-catch.js'
import { csharpSelfComparisonVisitor } from './self-comparison.js'
import { csharpSelfAssignmentVisitor } from './self-assignment.js'
import { csharpAssignmentInConditionVisitor } from './assignment-in-condition.js'
import { csharpAllBranchesIdenticalVisitor } from './all-branches-identical.js'
import { csharpDuplicateElseIfVisitor } from './duplicate-else-if.js'
import { csharpDuplicateBranchesVisitor } from './duplicate-branches.js'
import { csharpConstantConditionVisitor } from './constant-condition.js'
import { csharpUnreachableCodeVisitor } from './unreachable-code.js'
import { csharpUnreachableLoopVisitor } from './unreachable-loop.js'
import { csharpForDirectionVisitor } from './for-direction.js'
import { csharpUnmodifiedLoopConditionVisitor } from './unmodified-loop-condition.js'
import { csharpLoopCounterAssignmentVisitor } from './loop-counter-assignment.js'
import { csharpFloatEqualityComparisonVisitor } from './float-equality-comparison.js'
import { csharpNanComparisonVisitor } from './nan-comparison.js'
import { csharpIndexOfPositiveCheckVisitor } from './index-of-positive-check.js'
import { csharpCollectionSizeMischeckVisitor } from './collection-size-mischeck.js'
import { csharpStringFormatMismatchVisitor } from './string-format-mismatch.js'
import { csharpLoggingArgsMismatchVisitor } from './logging-args-mismatch.js'
import { csharpDuplicateKeysVisitor } from './duplicate-keys.js'
import { csharpUselessExceptionStatementVisitor } from './useless-exception-statement.js'
import { csharpLostErrorContextVisitor } from './lost-error-context.js'
import { csharpExceptionReassignmentVisitor } from './exception-reassignment.js'
import { csharpInfiniteRecursionVisitor } from './infinite-recursion.js'
import { csharpGenericErrorMessageVisitor } from './generic-error-message.js'
import { csharpModifiedLoopIteratorVisitor } from './modified-loop-iterator.js'
import { csharpIgnoredReturnValueVisitor } from './ignored-return-value.js'
import { csharpBlockingCallInAsyncVisitor } from './blocking-call-in-async.js'
import { csharpAsyncBusyWaitVisitor } from './async-busy-wait.js'
import { csharpAsyncVoidFunctionVisitor } from './async-void-function.js'
import { csharpMissingReturnAwaitVisitor } from './missing-return-await.js'
import { csharpSwitchExhaustivenessVisitor } from './switch-exhaustiveness.js'
import { csharpUnsafeFinallyVisitor } from './unsafe-finally.js'
import { csharpEmptyFinalizerVisitor } from './empty-finalizer.js'
import { csharpNestedTryCatchVisitor } from './nested-try-catch.js'
import { csharpElementOverwriteVisitor } from './element-overwrite.js'
import { csharpBaseToStringVisitor } from './base-to-string.js'
import { csharpInvalidRegexpVisitor } from './invalid-regexp.js'
import { csharpEmptyCharacterClassVisitor } from './empty-character-class.js'
import { csharpControlCharsInRegexVisitor } from './control-chars-in-regex.js'
import { csharpMisleadingCharacterClassVisitor } from './misleading-character-class.js'
import { csharpUselessBackreferenceVisitor } from './useless-backreference.js'
import { csharpRegexBackreferenceInvalidVisitor } from './regex-backreference-invalid.js'
import { csharpRegexAlternativesRedundantVisitor } from './regex-alternatives-redundant.js'
import { csharpRegexBoundaryUnmatchableVisitor } from './regex-boundary-unmatchable.js'
import { csharpRegexLookaheadContradictoryVisitor } from './regex-lookahead-contradictory.js'
import { csharpRegexPossessiveAlwaysFailsVisitor } from './regex-possessive-always-fails.js'
import { csharpRegexGroupReferenceMismatchVisitor } from './regex-group-reference-mismatch.js'
import { csharpCancellationExceptionNotReraisedVisitor } from './cancellation-exception-not-reraised.js'
import { csharpDatetimeWithoutTimezoneVisitor } from './datetime-without-timezone.js'
import { csharpDecimalFromFloatVisitor } from './decimal-from-float.js'
import { csharpNonExistentOperatorVisitor } from './non-existent-operator.js'
import { csharpBidirectionalUnicodeVisitor } from './bidirectional-unicode.js'
import { csharpInvisibleWhitespaceVisitor } from './invisible-whitespace.js'
import { csharpInvalidCharacterInSourceVisitor } from './invalid-character-in-source.js'
import { csharpLossOfPrecisionVisitor } from './loss-of-precision.js'
import { csharpConstantBinaryExpressionVisitor } from './constant-binary-expression.js'
import { csharpConfusingIncrementDecrementVisitor } from './confusing-increment-decrement.js'
import { csharpNewObjectIdentityCheckVisitor } from './new-object-identity-check.js'
import { csharpRaceConditionAssignmentVisitor } from './race-condition-assignment.js'
import { csharpReduceMissingInitialVisitor } from './reduce-missing-initial.js'
import { csharpUselessFinallyVisitor } from './useless-finally.js'
import { csharpFstringMissingPlaceholdersVisitor } from './fstring-missing-placeholders.js'
import { csharpLowercaseEnvironmentVariableVisitor } from './lowercase-environment-variable.js'
import { csharpDuplicateSetValueVisitor } from './duplicate-set-value.js'
import { csharpEmptyCollectionAccessVisitor } from './empty-collection-access.js'
import { csharpPotentialIndexErrorVisitor } from './potential-index-error.js'
import { csharpArgumentsOrderMismatchVisitor } from './arguments-order-mismatch.js'
import { csharpInvariantReturnVisitor } from './invariant-return.js'
import { csharpTypeComparisonVisitor } from './type-comparison.js'
import { csharpUselessIncrementVisitor } from './useless-increment.js'
import { csharpUnusedLoopVariableVisitor } from './unused-loop-variable.js'
import { csharpAssertRaisesTooBroadVisitor } from './assert-raises-too-broad.js'
import { csharpBareExceptVisitor } from './bare-except.js'
import { csharpDatetime12hFormatWithoutAmpmVisitor } from './datetime-12h-format-without-ampm.js'
import { csharpDatetimeConstructorRangeVisitor } from './datetime-constructor-range.js'
import { csharpInEmptyCollectionVisitor } from './in-empty-collection.js'
import { csharpLoopAtMostOneIterationVisitor } from './loop-at-most-one-iteration.js'
import { csharpMissingFstringSyntaxVisitor } from './missing-fstring-syntax.js'
import { csharpStaticKeyDictComprehensionVisitor } from './static-key-dict-comprehension.js'
import { csharpUnrawRePatternVisitor } from './unraw-re-pattern.js'
import { csharpAnonymousDelegateUnsubscribeVisitor } from './anonymous-delegate-unsubscribe.js'
import { csharpArgumentExceptionWrongParameterNameVisitor } from './argumentexception-wrong-parameter-name.js'
import { csharpAssertWithoutMessageVisitor } from './assert-without-message.js'
import { csharpDebugFailWithoutMessageVisitor } from './debug-fail-without-message.js'
import { csharpBaseCallOnObjectVisitor } from './base-call-on-object.js'
import { csharpCallerInfoParamNotLastVisitor } from './caller-info-param-not-last.js'
import { csharpCancellationTokenNotLastVisitor } from './cancellation-token-not-last.js'
import { csharpCatchNullReferenceExceptionVisitor } from './catch-null-reference-exception.js'
import { csharpChainedOrderByLosesOrderingVisitor } from './chained-orderby-loses-ordering.js'
import { csharpCheckAgainstValueBeingAssignedVisitor } from './check-against-value-being-assigned.js'
import { csharpCollectionPassedToOwnMethodVisitor } from './collection-passed-to-own-method.js'
import { csharpDateTimeParseNoFormatProviderVisitor } from './datetime-parse-no-format-provider.js'
import { csharpDoubledPrefixOperatorVisitor } from './doubled-prefix-operator.js'
import { csharpEmptyGuidConstructorVisitor } from './empty-guid-constructor.js'
import { csharpEmptyStatementVisitor } from './empty-statement.js'
import { csharpEnumDuplicateExplicitValueVisitor } from './enum-duplicate-explicit-value.js'
import { csharpFlagsEnumMissingZeroVisitor } from './flags-enum-missing-zero.js'
import { csharpIsCheckOnThisVisitor } from './is-check-on-this.js'
import { csharpLiteralControlCharacterVisitor } from './literal-control-character.js'
import { csharpPropertyAssignmentInOwnSetterVisitor } from './property-assignment-in-own-setter.js'
import { csharpUnusedValueKeywordInSetterVisitor } from './unused-value-keyword-in-setter.js'
import { csharpRedundantBaseCallVisitor } from './redundant-base-call.js'
import { csharpRouteTemplateBackslashVisitor } from './route-template-backslash.js'
import { csharpSequentialSameConditionVisitor } from './sequential-same-condition.js'
import { csharpStaticFieldInGenericTypeVisitor } from './static-field-in-generic-type.js'
import { csharpStackallocInLoopVisitor } from './stackalloc-in-loop.js'
import { csharpThreadStaticOnInstanceFieldVisitor } from './threadstatic-on-instance-field.js'
import { csharpThreadStaticInlineInitializationVisitor } from './threadstatic-inline-initialization.js'
import { csharpRecursiveTypeInheritanceVisitor } from './recursive-type-inheritance.js'
import { csharpRaiseReservedExceptionTypeVisitor } from './raise-reserved-exception-type.js'
import { csharpVirtualFieldLikeEventVisitor } from './virtual-field-like-event.js'
import { csharpSuppressFinalizeMisuseVisitor } from './suppressfinalize-misuse.js'
import { csharpClassOnlyPrivateConstructorsVisitor } from './class-only-private-constructors.js'
import { csharpInvalidShiftCountVisitor } from './invalid-shift-count.js'
import { csharpLockOnPublicReferenceVisitor } from './lock-on-public-reference.js'
import { csharpInstanceWritesStaticFieldVisitor } from './instance-writes-static-field.js'
import { csharpStaticFieldSetInConstructorVisitor } from './static-field-set-in-constructor.js'
import { csharpNonConstantStaticFieldVisibleVisitor } from './non-constant-static-field-visible.js'
import { csharpReadonlyMutableReferenceFieldVisitor } from './readonly-mutable-reference-field.js'
import { csharpOneWayOperationNonVoidVisitor } from './oneway-operation-non-void.js'
import { csharpFinalizerThrowsVisitor } from './finalizer-throws.js'
import { csharpVirtualCallInConstructorVisitor } from './virtual-call-in-constructor.js'
import { csharpOptionalOnRefOutParameterVisitor } from './optional-on-ref-out-parameter.js'
import { csharpPureMethodReturnsVoidVisitor } from './pure-method-returns-void.js'
import { csharpReturnNullTaskVisitor } from './return-null-task.js'
import { csharpToStringReturnsNullVisitor } from './tostring-returns-null.js'
import { csharpExceptionFromPropertyGetterVisitor } from './exception-from-property-getter.js'
import { csharpForConditionNeverTrueVisitor } from './for-condition-never-true.js'
import { csharpIrregularNumberPatternVisitor } from './irregular-number-pattern.js'
import { csharpDebugAssertSideEffectVisitor } from './debug-assert-side-effect.js'
import { csharpDateTimeNowForTimingVisitor } from './datetime-now-for-timing.js'
import { csharpStreamReaderEndOfStreamInAsyncVisitor } from './streamreader-endofstream-in-async.js'
import { csharpEnumImplicitValuesVisitor } from './enum-implicit-values.js'
import { csharpMaxResponseHeadersLengthMissetVisitor } from './maxresponseheaderslength-misset.js'
import { csharpSqlKeywordNotDelimitedVisitor } from './sql-keyword-not-delimited.js'
import { csharpAttributeStringLiteralParseVisitor } from './attribute-string-literal-parse.js'
import { csharpJsInvokableNonPublicVisitor } from './jsinvokable-non-public.js'
import { csharpBlazorUnsupportedQueryParamTypeVisitor } from './blazor-unsupported-query-param-type.js'

export const BUGS_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpEnumImplicitValuesVisitor,
  csharpMaxResponseHeadersLengthMissetVisitor,
  csharpSqlKeywordNotDelimitedVisitor,
  csharpAttributeStringLiteralParseVisitor,
  csharpEmptyCatchVisitor,
  csharpSelfComparisonVisitor,
  csharpSelfAssignmentVisitor,
  csharpAssignmentInConditionVisitor,
  csharpAllBranchesIdenticalVisitor,
  csharpDuplicateElseIfVisitor,
  csharpDuplicateBranchesVisitor,
  csharpConstantConditionVisitor,
  csharpUnreachableCodeVisitor,
  csharpUnreachableLoopVisitor,
  csharpForDirectionVisitor,
  csharpUnmodifiedLoopConditionVisitor,
  csharpLoopCounterAssignmentVisitor,
  csharpFloatEqualityComparisonVisitor,
  csharpNanComparisonVisitor,
  csharpIndexOfPositiveCheckVisitor,
  csharpCollectionSizeMischeckVisitor,
  csharpStringFormatMismatchVisitor,
  csharpLoggingArgsMismatchVisitor,
  csharpDuplicateKeysVisitor,
  csharpUselessExceptionStatementVisitor,
  csharpLostErrorContextVisitor,
  csharpExceptionReassignmentVisitor,
  csharpInfiniteRecursionVisitor,
  csharpGenericErrorMessageVisitor,
  csharpModifiedLoopIteratorVisitor,
  csharpIgnoredReturnValueVisitor,
  csharpBlockingCallInAsyncVisitor,
  csharpAsyncBusyWaitVisitor,
  csharpAsyncVoidFunctionVisitor,
  csharpMissingReturnAwaitVisitor,
  csharpSwitchExhaustivenessVisitor,
  csharpUnsafeFinallyVisitor,
  csharpEmptyFinalizerVisitor,
  csharpNestedTryCatchVisitor,
  csharpElementOverwriteVisitor,
  csharpBaseToStringVisitor,
  csharpInvalidRegexpVisitor,
  csharpEmptyCharacterClassVisitor,
  csharpControlCharsInRegexVisitor,
  csharpMisleadingCharacterClassVisitor,
  csharpUselessBackreferenceVisitor,
  csharpRegexBackreferenceInvalidVisitor,
  csharpRegexAlternativesRedundantVisitor,
  csharpRegexBoundaryUnmatchableVisitor,
  csharpRegexLookaheadContradictoryVisitor,
  csharpRegexPossessiveAlwaysFailsVisitor,
  csharpRegexGroupReferenceMismatchVisitor,
  csharpCancellationExceptionNotReraisedVisitor,
  csharpDatetimeWithoutTimezoneVisitor,
  csharpDecimalFromFloatVisitor,
  csharpNonExistentOperatorVisitor,
  csharpBidirectionalUnicodeVisitor,
  csharpInvisibleWhitespaceVisitor,
  csharpInvalidCharacterInSourceVisitor,
  csharpLossOfPrecisionVisitor,
  csharpConstantBinaryExpressionVisitor,
  csharpConfusingIncrementDecrementVisitor,
  csharpNewObjectIdentityCheckVisitor,
  csharpRaceConditionAssignmentVisitor,
  csharpReduceMissingInitialVisitor,
  csharpUselessFinallyVisitor,
  csharpFstringMissingPlaceholdersVisitor,
  csharpLowercaseEnvironmentVariableVisitor,
  csharpDuplicateSetValueVisitor,
  csharpEmptyCollectionAccessVisitor,
  csharpPotentialIndexErrorVisitor,
  csharpArgumentsOrderMismatchVisitor,
  csharpInvariantReturnVisitor,
  csharpTypeComparisonVisitor,
  csharpUselessIncrementVisitor,
  csharpUnusedLoopVariableVisitor,
  csharpAssertRaisesTooBroadVisitor,
  csharpBareExceptVisitor,
  csharpDatetime12hFormatWithoutAmpmVisitor,
  csharpDatetimeConstructorRangeVisitor,
  csharpInEmptyCollectionVisitor,
  csharpLoopAtMostOneIterationVisitor,
  csharpMissingFstringSyntaxVisitor,
  csharpStaticKeyDictComprehensionVisitor,
  csharpUnrawRePatternVisitor,
  csharpAnonymousDelegateUnsubscribeVisitor,
  csharpArgumentExceptionWrongParameterNameVisitor,
  csharpAssertWithoutMessageVisitor,
  csharpDebugFailWithoutMessageVisitor,
  csharpBaseCallOnObjectVisitor,
  csharpCallerInfoParamNotLastVisitor,
  csharpCancellationTokenNotLastVisitor,
  csharpCatchNullReferenceExceptionVisitor,
  csharpChainedOrderByLosesOrderingVisitor,
  csharpCheckAgainstValueBeingAssignedVisitor,
  csharpCollectionPassedToOwnMethodVisitor,
  csharpDateTimeParseNoFormatProviderVisitor,
  csharpDoubledPrefixOperatorVisitor,
  csharpEmptyGuidConstructorVisitor,
  csharpEmptyStatementVisitor,
  csharpEnumDuplicateExplicitValueVisitor,
  csharpFlagsEnumMissingZeroVisitor,
  csharpIsCheckOnThisVisitor,
  csharpLiteralControlCharacterVisitor,
  csharpPropertyAssignmentInOwnSetterVisitor,
  csharpUnusedValueKeywordInSetterVisitor,
  csharpRedundantBaseCallVisitor,
  csharpRouteTemplateBackslashVisitor,
  csharpSequentialSameConditionVisitor,
  csharpStaticFieldInGenericTypeVisitor,
  csharpStackallocInLoopVisitor,
  csharpThreadStaticOnInstanceFieldVisitor,
  csharpThreadStaticInlineInitializationVisitor,
  csharpRecursiveTypeInheritanceVisitor,
  csharpRaiseReservedExceptionTypeVisitor,
  csharpVirtualFieldLikeEventVisitor,
  csharpSuppressFinalizeMisuseVisitor,
  csharpClassOnlyPrivateConstructorsVisitor,
  csharpInvalidShiftCountVisitor,
  csharpLockOnPublicReferenceVisitor,
  csharpInstanceWritesStaticFieldVisitor,
  csharpStaticFieldSetInConstructorVisitor,
  csharpNonConstantStaticFieldVisibleVisitor,
  csharpReadonlyMutableReferenceFieldVisitor,
  csharpOneWayOperationNonVoidVisitor,
  csharpFinalizerThrowsVisitor,
  csharpVirtualCallInConstructorVisitor,
  csharpOptionalOnRefOutParameterVisitor,
  csharpPureMethodReturnsVoidVisitor,
  csharpReturnNullTaskVisitor,
  csharpToStringReturnsNullVisitor,
  csharpExceptionFromPropertyGetterVisitor,
  csharpForConditionNeverTrueVisitor,
  csharpIrregularNumberPatternVisitor,
  csharpDebugAssertSideEffectVisitor,
  csharpDateTimeNowForTimingVisitor,
  csharpStreamReaderEndOfStreamInAsyncVisitor,
  csharpJsInvokableNonPublicVisitor,
  csharpBlazorUnsupportedQueryParamTypeVisitor,
]
