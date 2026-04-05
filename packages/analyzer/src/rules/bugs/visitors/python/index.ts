import type { CodeRuleVisitor } from '../../../types.js'

import { pythonEmptyCatchVisitor } from './empty-catch.js'
import { pythonBareExceptVisitor } from './bare-except.js'
import { pythonMutableDefaultArgVisitor } from './mutable-default-arg.js'
import { pythonSelfComparisonVisitor } from './self-comparison.js'
import { pythonSelfAssignmentVisitor } from './self-assignment.js'
import { pythonDuplicateKeysVisitor } from './duplicate-keys.js'
import { pythonDuplicateArgsVisitor } from './duplicate-args.js'
import { pythonAllBranchesIdenticalVisitor } from './all-branches-identical.js'
import { pythonConstantConditionVisitor } from './constant-condition.js'
import { pythonUnreachableCodeVisitor } from './unreachable-code.js'
import { pythonDuplicateClassMembersVisitor } from './duplicate-class-members.js'
import { pythonDuplicateElseIfVisitor } from './duplicate-else-if.js'
import { pythonUnsafeFinallyVisitor } from './unsafe-finally.js'
import { pythonGetterMissingReturnVisitor } from './getter-missing-return.js'
import { pythonEmptyCharacterClassVisitor } from './empty-character-class.js'
import { pythonExceptionReassignmentVisitor } from './exception-reassignment.js'
import { pythonAssertOnTupleVisitor } from './assert-on-tuple.js'
import { pythonFstringMissingPlaceholdersVisitor } from './fstring-missing-placeholders.js'
import { pythonRaiseNotImplementedVisitor } from './raise-not-implemented.js'
import { pythonIsLiteralComparisonVisitor } from './is-literal-comparison.js'
import { pythonNoneComparisonVisitor } from './none-comparison.js'
import { pythonTypeComparisonVisitor } from './type-comparison.js'
import { pythonDuplicateSetValueVisitor } from './duplicate-set-value.js'
import { pythonLoopVariableOverridesIteratorVisitor } from './loop-variable-overrides-iterator.js'
import { pythonRaiseWithoutFromVisitor } from './raise-without-from.js'
import { pythonInitReturnValueVisitor } from './init-return-value.js'
import { pythonYieldInInitVisitor } from './yield-in-init.js'
import { pythonDuplicateBaseClassesVisitor } from './duplicate-base-classes.js'
import { pythonFloatEqualityComparisonVisitor } from './float-equality-comparison.js'
import { pythonFunctionCallInDefaultArgVisitor } from './function-call-in-default-arg.js'
import { pythonZipWithoutStrictVisitor } from './zip-without-strict.js'
import { pythonRaiseLiteralVisitor } from './raise-literal.js'
import { pythonBadOpenModeVisitor } from './bad-open-mode.js'
import { pythonLoopAtMostOneIterationVisitor } from './loop-at-most-one-iteration.js'
import { pythonBreakContinueInFinallyVisitor } from './break-continue-in-finally.js'
import { pythonInfiniteRecursionVisitor } from './infinite-recursion.js'
import { pythonDuplicateHandlerExceptionVisitor } from './duplicate-handler-exception.js'
import { pythonMutableClassDefaultVisitor } from './mutable-class-default.js'
import { pythonMutableDataclassDefaultVisitor } from './mutable-dataclass-default.js'
import { pythonAwaitOutsideAsyncVisitor } from './await-outside-async.js'
import { pythonAsyncioDanglingTaskVisitor } from './asyncio-dangling-task.js'
import { pythonUnexpectedSpecialMethodSignatureVisitor } from './unexpected-special-method-signature.js'
import { pythonDuplicateFunctionArgumentsVisitor } from './duplicate-function-arguments.js'
import { pythonNotImplementedInBoolContextVisitor } from './not-implemented-in-bool-context.js'
import { pythonCancellationExceptionNotReraisedVisitor } from './cancellation-exception-not-reraised.js'
import { pythonAssertRaisesTooBroadVisitor } from './assert-raises-too-broad.js'
import { pythonHashableSetDictMemberVisitor } from './hashable-set-dict-member.js'
import { pythonIterNotReturningIteratorVisitor } from './iter-not-returning-iterator.js'
import { pythonModifiedLoopIteratorVisitor } from './modified-loop-iterator.js'
import { pythonUndefinedExportVisitor } from './undefined-export.js'
import { pythonStringFormatMismatchVisitor } from './string-format-mismatch.js'
import { pythonDuplicateImportVisitor } from './duplicate-import.js'
import { pythonExceptionNotFromBaseExceptionVisitor } from './exception-not-from-base-exception.js'
import { pythonInvalidSpecialMethodReturnTypeVisitor } from './invalid-special-method-return-type.js'
import { pythonExceptionGroupMisuseVisitor } from './exception-group-misuse.js'
import { pythonUnreliableCallableCheckVisitor } from './unreliable-callable-check.js'
import { pythonStripWithMultiCharsVisitor } from './strip-with-multi-chars.js'
import { pythonAssertFalseVisitor } from './assert-false.js'
import { pythonRedundantTupleInExceptionVisitor } from './redundant-tuple-in-exception.js'
import { pythonExceptWithEmptyTupleVisitor } from './except-with-empty-tuple.js'
import { pythonUnintentionalTypeAnnotationVisitor } from './unintentional-type-annotation.js'
import { pythonReSubPositionalArgsVisitor } from './re-sub-positional-args.js'
import { pythonStaticKeyDictComprehensionVisitor } from './static-key-dict-comprehension.js'
import { pythonFstringDocstringVisitor } from './fstring-docstring.js'
import { pythonUselessContextlibSuppressVisitor } from './useless-contextlib-suppress.js'
import { pythonStarArgAfterKeywordVisitor } from './star-arg-after-keyword.js'
import { pythonNanComparisonVisitor } from './nan-comparison.js'
import { pythonAssignmentToOsEnvironVisitor } from './assignment-to-os-environ.js'
import { pythonAssertOnStringLiteralVisitor } from './assert-on-string-literal.js'
import { pythonBinaryOpExceptionVisitor } from './binary-op-exception.js'
import { pythonSuperWithoutBracketsVisitor } from './super-without-brackets.js'
import { pythonYieldFromInAsyncVisitor } from './yield-from-in-async.js'
import { pythonInvalidAllObjectVisitor } from './invalid-all-object.js'
import { pythonMutableFromkeysValueVisitor } from './mutable-fromkeys-value.js'
import { pythonExceptNonExceptionClassVisitor } from './except-non-exception-class.js'
import { pythonReuseGroupbyGeneratorVisitor } from './reuse-groupby-generator.js'
import { pythonMutableContextvarDefaultVisitor } from './mutable-contextvar-default.js'
import { pythonImportSelfVisitor } from './import-self.js'
import { pythonInvalidEnvvarValueVisitor } from './invalid-envvar-value.js'
import { pythonSingledispatchMethodMismatchVisitor } from './singledispatch-method-mismatch.js'
import { pythonBidirectionalUnicodeVisitor } from './bidirectional-unicode.js'
import { pythonDictIterMissingItemsVisitor } from './dict-iter-missing-items.js'
import { pythonNonlocalAndGlobalVisitor } from './nonlocal-and-global.js'
import { pythonComparisonToNoneConstantVisitor } from './comparison-to-none-constant.js'
import { pythonNewObjectIdentityCheckVisitor } from './new-object-identity-check.js'
import { pythonPropertyWithoutReturnVisitor } from './property-without-return.js'
import { pythonInstanceMethodMissingSelfVisitor } from './instance-method-missing-self.js'
import { pythonPropertyParamCountWrongVisitor } from './property-param-count-wrong.js'
import { pythonExitReRaiseInExceptVisitor } from './exit-re-raise-in-except.js'
import { pythonParameterInitialValueIgnoredVisitor } from './parameter-initial-value-ignored.js'
import { pythonDefaultdictDefaultFactoryKwargVisitor } from './defaultdict-default-factory-kwarg.js'
import { pythonAssignmentInAssertVisitor } from './assignment-in-assert.js'
import { pythonAssertWithPrintMessageVisitor } from './assert-with-print-message.js'
import { pythonDecimalFromFloatVisitor } from './decimal-from-float.js'
import { pythonDuplicateDictKeyVisitor } from './duplicate-dict-key.js'
import { pythonRedefinedWhileUnusedVisitor } from './redefined-while-unused.js'
import { pythonBadStringFormatCharacterVisitor } from './bad-string-format-character.js'
import { pythonNonlocalWithoutBindingVisitor } from './nonlocal-without-binding.js'
import { pythonLoadBeforeGlobalDeclarationVisitor } from './load-before-global-declaration.js'
import { pythonAsyncFunctionWithTimeoutVisitor } from './async-function-with-timeout.js'
import { pythonAsyncBusyWaitVisitor } from './async-busy-wait.js'
import { pythonWarningsNoStacklevelVisitor } from './warnings-no-stacklevel.js'
import { pythonUnusedLoopVariableVisitor } from './unused-loop-variable.js'
import { pythonReturnInGeneratorVisitor } from './return-in-generator.js'
import { pythonBatchedWithoutStrictVisitor } from './batched-without-strict.js'
import { pythonDatetimeWithoutTimezoneVisitor } from './datetime-without-timezone.js'
import { pythonDatetimeMinMaxVisitor } from './datetime-min-max.js'
import { pythonLoggingDeprecatedWarnVisitor } from './logging-deprecated-warn.js'
import { pythonLoggingInvalidGetloggerVisitor } from './logging-invalid-getlogger.js'
import { pythonLoggingExceptionOutsideHandlerVisitor } from './logging-exception-outside-handler.js'
import { pythonInvalidMockAccessVisitor } from './invalid-mock-access.js'
import { pythonUselessExceptionStatementVisitor } from './useless-exception-statement.js'
import { pythonSelfOrClsAssignmentVisitor } from './self-or-cls-assignment.js'
import { pythonGlobalAtModuleLevelVisitor } from './global-at-module-level.js'
import { pythonBadStaticmethodArgumentVisitor } from './bad-staticmethod-argument.js'
import { pythonSubprocessPopenPreexecFnVisitor } from './subprocess-popen-preexec-fn.js'
import { pythonRedefinedArgumentFromLocalVisitor } from './redefined-argument-from-local.js'
import { pythonDuplicateEntryDunderAllVisitor } from './duplicate-entry-dunder-all.js'
import { pythonUselessFinallyVisitor } from './useless-finally.js'
import { pythonFalsyDictGetFallbackVisitor } from './falsy-dict-get-fallback.js'
import { pythonAssertionAfterExpectedExceptionVisitor } from './assertion-after-expected-exception.js'
import { pythonMathIscloseZeroNoAbstolVisitor } from './math-isclose-zero-no-abstol.js'
import { pythonDatetime12hFormatWithoutAmpmVisitor } from './datetime-12h-format-without-ampm.js'
import { pythonSklearnEstimatorTrailingUnderscoreVisitor } from './sklearn-estimator-trailing-underscore.js'
import { pythonYieldReturnOutsideFunctionVisitor } from './yield-return-outside-function.js'
import { pythonPytestAssertAlwaysFalseVisitor } from './pytest-assert-always-false.js'
import { pythonUnaryPrefixIncrementDecrementVisitor } from './unary-prefix-increment-decrement.js'
import { pythonSingleStringSlotsVisitor } from './single-string-slots.js'
import { pythonMapWithoutStrictVisitor } from './map-without-strict.js'
import { pythonNestedTryCatchVisitor } from './nested-try-catch.js'
import { pythonSharedMutableModuleStateVisitor } from './shared-mutable-module-state.js'
import { pythonPandasNuniqueConstantSeriesVisitor } from './pandas-nunique-constant-series.js'
import { pythonUnsupportedMethodCallOnAllVisitor } from './unsupported-method-call-on-all.js'
import { pythonInvalidPathlibWithSuffixVisitor } from './invalid-pathlib-with-suffix.js'
import { pythonDataclassEnumConflictVisitor } from './dataclass-enum-conflict.js'
import { pythonAccessAnnotationsFromClassDictVisitor } from './access-annotations-from-class-dict.js'
import { pythonInvalidPrintSyntaxVisitor } from './invalid-print-syntax.js'
import { pythonDefaultExceptNotLastVisitor } from './default-except-not-last.js'
import { pythonUnreliableSysVersionCheckVisitor } from './unreliable-sys-version-check.js'
import { pythonLowercaseEnvironmentVariableVisitor } from './lowercase-environment-variable.js'
import { pythonFstringInGettextVisitor } from './fstring-in-gettext.js'
import { pythonExitMethodWrongSignatureVisitor } from './exit-method-wrong-signature.js'
import { pythonMembersDifferOnlyByCaseVisitor } from './members-differ-only-by-case.js'
import { pythonClassmethodFirstArgumentNamingVisitor } from './classmethod-first-argument-naming.js'
import { pythonImportStarUndefinedVisitor } from './import-star-undefined.js'
import { pythonFutureFeatureNotDefinedVisitor } from './future-feature-not-defined.js'
import { pythonIfTupleAlwaysTrueVisitor } from './if-tuple-always-true.js'
import { pythonTrioSyncCallVisitor } from './trio-sync-call.js'
import { pythonReturnInTryExceptFinallyVisitor } from './return-in-try-except-finally.js'
import { pythonBareRaiseInFinallyVisitor } from './bare-raise-in-finally.js'
import { pythonOsPathCommonprefixBugVisitor } from './os-path-commonprefix-bug.js'
import { pythonLoggingExceptionNoExcInfoVisitor } from './logging-exception-no-exc-info.js'
import { pythonIterReturnsIterableVisitor } from './iter-returns-iterable.js'
import { pythonLegacyPytestRaisesVisitor } from './legacy-pytest-raises.js'
import { pythonLoggingArgsMismatchVisitor } from './logging-args-mismatch.js'
import { pythonNonSlotAssignmentVisitor } from './non-slot-assignment.js'
import { pythonInvalidIndexTypeVisitor } from './invalid-index-type.js'
import { pythonNonIterableUnpackingVisitor } from './non-iterable-unpacking.js'
import { pythonBlockingCallInAsyncVisitor } from './blocking-call-in-async.js'
import { pythonCancelScopeNoCheckpointVisitor } from './cancel-scope-no-checkpoint.js'
import { pythonControlFlowInTaskGroupVisitor } from './control-flow-in-task-group.js'
import { pythonPotentialIndexErrorVisitor } from './potential-index-error.js'
import { pythonRegexInvalidPythonVisitor } from './regex-invalid-python.js'
import { pythonRegexEmptyAlternativePythonVisitor } from './regex-empty-alternative-python.js'
import { pythonRegexBackreferenceInvalidVisitor } from './regex-backreference-invalid.js'
import { pythonRegexGroupReferenceMismatchPythonVisitor } from './regex-group-reference-mismatch-python.js'
import { pythonTemplateStringNotProcessedVisitor } from './template-string-not-processed.js'
import { pythonTemplateStrConcatenationVisitor } from './template-str-concatenation.js'
import { pythonInconsistentTupleReturnLengthVisitor } from './inconsistent-tuple-return-length.js'
import { pythonInvalidAssertMessageVisitor } from './invalid-assert-message.js'
import { pythonNeverUnionVisitor } from './never-union.js'
import { pythonImplicitOptionalVisitor } from './implicit-optional.js'
import { pythonInEmptyCollectionVisitor } from './in-empty-collection.js'
import { pythonMissingFstringSyntaxVisitor } from './missing-fstring-syntax.js'
import { pythonUnrawRePatternVisitor } from './unraw-re-pattern.js'
import { pythonLambdaAssignmentVisitor } from './lambda-assignment.js'
import { pythonDjangoJsonResponseSafeFlagVisitor } from './django-json-response-safe-flag.js'
import { pythonFlaskQueryParamsInPostVisitor } from './flask-query-params-in-post.js'
import { pythonFlaskHeaderAccessKeyerrorVisitor } from './flask-header-access-keyerror.js'
import { pythonFlaskClassViewDecoratorWrongVisitor } from './flask-class-view-decorator-wrong.js'
import { pythonFlaskPreprocessReturnUnhandledVisitor } from './flask-preprocess-return-unhandled.js'
import { pythonFlaskSendFileMissingMimetypeVisitor } from './flask-send-file-missing-mimetype.js'
import { pythonFastapi204WithBodyVisitor } from './fastapi-204-with-body.js'
import { pythonFastapiChildRouterOrderVisitor } from './fastapi-child-router-order.js'
import { pythonFastapiUnusedPathParameterVisitor } from './fastapi-unused-path-parameter.js'
import { pythonFastapiRedundantResponseModelVisitor } from './fastapi-redundant-response-model.js'
import { pythonLambdaNetworkCallNoTimeoutVisitor } from './lambda-network-call-no-timeout.js'
import { pythonLambdaTmpNotCleanedVisitor } from './lambda-tmp-not-cleaned.js'
import { pythonPytorchNnModuleMissingSuperVisitor } from './pytorch-nn-module-missing-super.js'
import { pythonGenericErrorMessageVisitor } from './generic-error-message.js'
import { pythonNamedExprWithoutContextVisitor } from './named-expr-without-context.js'
import { pythonInvalidCharacterInSourceVisitor } from './invalid-character-in-source.js'
import { pythonPostInitDefaultVisitor } from './post-init-default.js'
import { pythonImplicitClassvarInDataclassVisitor } from './implicit-classvar-in-dataclass.js'
import { pythonConfusingImplicitConcatVisitor } from './confusing-implicit-concat.js'
import { pythonNumpyWeekmaskInvalidVisitor } from './numpy-weekmask-invalid.js'
import { pythonDatetimeConstructorRangeVisitor } from './datetime-constructor-range.js'
import { pythonTfFunctionSideEffectsVisitor } from './tf-function-side-effects.js'
import { pythonMlReductionAxisMissingVisitor } from './ml-reduction-axis-missing.js'
import { pythonPytestFixtureMisuseVisitor } from './pytest-fixture-misuse.js'
import { pythonAirflowUsageErrorVisitor } from './airflow-usage-error.js'
import { pythonStarAssignmentErrorVisitor } from './star-assignment-error.js'
import { pythonStaticKeyDictComprehensionRuffVisitor } from './static-key-dict-comprehension-ruff.js'
import { pythonPytestRaisesAmbiguousPatternVisitor } from './pytest-raises-ambiguous-pattern.js'
import { pythonUsedDummyVariableVisitor } from './used-dummy-variable.js'
import { pythonFastapiCorsMiddlewareOrderVisitor } from './fastapi-cors-middleware-order.js'
import { pythonDictIndexMissingItemsVisitor } from './dict-index-missing-items.js'
import { pythonRegexAlternativesRedundantVisitor } from './regex-alternatives-redundant.js'
import { pythonRegexLookaheadContradictoryVisitor } from './regex-lookahead-contradictory.js'
import { pythonRegexBoundaryUnmatchableVisitor } from './regex-boundary-unmatchable.js'
import { pythonRegexPossessiveAlwaysFailsVisitor } from './regex-possessive-always-fails.js'
import { pythonEinopsPatternInvalidVisitor } from './einops-pattern-invalid.js'
import { pythonLambdaHandlerReturnsNonSerializableVisitor } from './lambda-handler-returns-non-serializable.js'
import { pythonSklearnPipelineInvalidParamsVisitor } from './sklearn-pipeline-invalid-params.js'
import { pythonForwardAnnotationSyntaxErrorVisitor } from './forward-annotation-syntax-error.js'
import { pythonRuntimeImportInTypeCheckingVisitor } from './runtime-import-in-type-checking.js'
import { pythonRedefinedSlotsInSubclassVisitor } from './redefined-slots-in-subclass.js'

export const BUGS_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonEmptyCatchVisitor,
  pythonBareExceptVisitor,
  pythonMutableDefaultArgVisitor,
  pythonSelfComparisonVisitor,
  pythonSelfAssignmentVisitor,
  pythonDuplicateKeysVisitor,
  pythonDuplicateArgsVisitor,
  pythonAllBranchesIdenticalVisitor,
  pythonConstantConditionVisitor,
  pythonUnreachableCodeVisitor,
  pythonDuplicateClassMembersVisitor,
  pythonDuplicateElseIfVisitor,
  pythonUnsafeFinallyVisitor,
  pythonGetterMissingReturnVisitor,
  pythonEmptyCharacterClassVisitor,
  pythonExceptionReassignmentVisitor,
  pythonAssertOnTupleVisitor,
  pythonFstringMissingPlaceholdersVisitor,
  pythonRaiseNotImplementedVisitor,
  pythonIsLiteralComparisonVisitor,
  pythonNoneComparisonVisitor,
  pythonTypeComparisonVisitor,
  pythonDuplicateSetValueVisitor,
  pythonLoopVariableOverridesIteratorVisitor,
  pythonRaiseWithoutFromVisitor,
  pythonInitReturnValueVisitor,
  pythonYieldInInitVisitor,
  pythonDuplicateBaseClassesVisitor,
  pythonFloatEqualityComparisonVisitor,
  pythonFunctionCallInDefaultArgVisitor,
  pythonZipWithoutStrictVisitor,
  pythonRaiseLiteralVisitor,
  pythonBadOpenModeVisitor,
  pythonLoopAtMostOneIterationVisitor,
  pythonBreakContinueInFinallyVisitor,
  pythonInfiniteRecursionVisitor,
  pythonDuplicateHandlerExceptionVisitor,
  pythonMutableClassDefaultVisitor,
  pythonMutableDataclassDefaultVisitor,
  pythonAwaitOutsideAsyncVisitor,
  pythonAsyncioDanglingTaskVisitor,
  pythonUnexpectedSpecialMethodSignatureVisitor,
  pythonDuplicateFunctionArgumentsVisitor,
  pythonNotImplementedInBoolContextVisitor,
  pythonCancellationExceptionNotReraisedVisitor,
  pythonAssertRaisesTooBroadVisitor,
  pythonHashableSetDictMemberVisitor,
  pythonIterNotReturningIteratorVisitor,
  pythonModifiedLoopIteratorVisitor,
  pythonUndefinedExportVisitor,
  pythonStringFormatMismatchVisitor,
  pythonDuplicateImportVisitor,
  pythonExceptionNotFromBaseExceptionVisitor,
  pythonInvalidSpecialMethodReturnTypeVisitor,
  pythonExceptionGroupMisuseVisitor,
  pythonUnreliableCallableCheckVisitor,
  pythonStripWithMultiCharsVisitor,
  pythonAssertFalseVisitor,
  pythonRedundantTupleInExceptionVisitor,
  pythonExceptWithEmptyTupleVisitor,
  pythonUnintentionalTypeAnnotationVisitor,
  pythonReSubPositionalArgsVisitor,
  pythonStaticKeyDictComprehensionVisitor,
  pythonFstringDocstringVisitor,
  pythonUselessContextlibSuppressVisitor,
  pythonStarArgAfterKeywordVisitor,
  pythonNanComparisonVisitor,
  pythonAssignmentToOsEnvironVisitor,
  pythonAssertOnStringLiteralVisitor,
  pythonBinaryOpExceptionVisitor,
  pythonSuperWithoutBracketsVisitor,
  pythonYieldFromInAsyncVisitor,
  pythonInvalidAllObjectVisitor,
  pythonMutableFromkeysValueVisitor,
  pythonExceptNonExceptionClassVisitor,
  pythonReuseGroupbyGeneratorVisitor,
  pythonMutableContextvarDefaultVisitor,
  pythonImportSelfVisitor,
  pythonInvalidEnvvarValueVisitor,
  pythonSingledispatchMethodMismatchVisitor,
  pythonBidirectionalUnicodeVisitor,
  pythonDictIterMissingItemsVisitor,
  pythonNonlocalAndGlobalVisitor,
  pythonComparisonToNoneConstantVisitor,
  pythonNewObjectIdentityCheckVisitor,
  pythonPropertyWithoutReturnVisitor,
  pythonInstanceMethodMissingSelfVisitor,
  pythonPropertyParamCountWrongVisitor,
  pythonExitReRaiseInExceptVisitor,
  pythonParameterInitialValueIgnoredVisitor,
  pythonDefaultdictDefaultFactoryKwargVisitor,
  pythonAssignmentInAssertVisitor,
  pythonAssertWithPrintMessageVisitor,
  pythonDecimalFromFloatVisitor,
  pythonDuplicateDictKeyVisitor,
  pythonRedefinedWhileUnusedVisitor,
  pythonBadStringFormatCharacterVisitor,
  pythonNonlocalWithoutBindingVisitor,
  pythonLoadBeforeGlobalDeclarationVisitor,
  pythonAsyncFunctionWithTimeoutVisitor,
  pythonAsyncBusyWaitVisitor,
  pythonWarningsNoStacklevelVisitor,
  pythonUnusedLoopVariableVisitor,
  pythonReturnInGeneratorVisitor,
  pythonBatchedWithoutStrictVisitor,
  pythonDatetimeWithoutTimezoneVisitor,
  pythonDatetimeMinMaxVisitor,
  pythonLoggingDeprecatedWarnVisitor,
  pythonLoggingInvalidGetloggerVisitor,
  pythonLoggingExceptionOutsideHandlerVisitor,
  pythonInvalidMockAccessVisitor,
  pythonUselessExceptionStatementVisitor,
  pythonSelfOrClsAssignmentVisitor,
  pythonGlobalAtModuleLevelVisitor,
  pythonBadStaticmethodArgumentVisitor,
  pythonSubprocessPopenPreexecFnVisitor,
  pythonRedefinedArgumentFromLocalVisitor,
  pythonDuplicateEntryDunderAllVisitor,
  pythonUselessFinallyVisitor,
  pythonFalsyDictGetFallbackVisitor,
  pythonAssertionAfterExpectedExceptionVisitor,
  pythonMathIscloseZeroNoAbstolVisitor,
  pythonDatetime12hFormatWithoutAmpmVisitor,
  pythonSklearnEstimatorTrailingUnderscoreVisitor,
  pythonYieldReturnOutsideFunctionVisitor,
  pythonPytestAssertAlwaysFalseVisitor,
  pythonUnaryPrefixIncrementDecrementVisitor,
  pythonSingleStringSlotsVisitor,
  pythonMapWithoutStrictVisitor,
  pythonNestedTryCatchVisitor,
  pythonSharedMutableModuleStateVisitor,
  pythonPandasNuniqueConstantSeriesVisitor,
  pythonUnsupportedMethodCallOnAllVisitor,
  pythonInvalidPathlibWithSuffixVisitor,
  pythonDataclassEnumConflictVisitor,
  pythonAccessAnnotationsFromClassDictVisitor,
  pythonInvalidPrintSyntaxVisitor,
  pythonDefaultExceptNotLastVisitor,
  pythonUnreliableSysVersionCheckVisitor,
  pythonLowercaseEnvironmentVariableVisitor,
  pythonFstringInGettextVisitor,
  pythonExitMethodWrongSignatureVisitor,
  pythonMembersDifferOnlyByCaseVisitor,
  pythonClassmethodFirstArgumentNamingVisitor,
  pythonImportStarUndefinedVisitor,
  pythonFutureFeatureNotDefinedVisitor,
  pythonIfTupleAlwaysTrueVisitor,
  pythonTrioSyncCallVisitor,
  pythonReturnInTryExceptFinallyVisitor,
  pythonBareRaiseInFinallyVisitor,
  pythonOsPathCommonprefixBugVisitor,
  pythonLoggingExceptionNoExcInfoVisitor,
  pythonIterReturnsIterableVisitor,
  pythonLegacyPytestRaisesVisitor,
  pythonLoggingArgsMismatchVisitor,
  pythonNonSlotAssignmentVisitor,
  pythonInvalidIndexTypeVisitor,
  pythonNonIterableUnpackingVisitor,
  pythonBlockingCallInAsyncVisitor,
  pythonCancelScopeNoCheckpointVisitor,
  pythonControlFlowInTaskGroupVisitor,
  pythonPotentialIndexErrorVisitor,
  pythonRegexInvalidPythonVisitor,
  pythonRegexEmptyAlternativePythonVisitor,
  pythonRegexBackreferenceInvalidVisitor,
  pythonRegexGroupReferenceMismatchPythonVisitor,
  pythonTemplateStringNotProcessedVisitor,
  pythonTemplateStrConcatenationVisitor,
  pythonInconsistentTupleReturnLengthVisitor,
  pythonInvalidAssertMessageVisitor,
  pythonNeverUnionVisitor,
  pythonImplicitOptionalVisitor,
  pythonInEmptyCollectionVisitor,
  pythonMissingFstringSyntaxVisitor,
  pythonUnrawRePatternVisitor,
  pythonLambdaAssignmentVisitor,
  pythonDjangoJsonResponseSafeFlagVisitor,
  pythonFlaskQueryParamsInPostVisitor,
  pythonFlaskHeaderAccessKeyerrorVisitor,
  pythonFlaskClassViewDecoratorWrongVisitor,
  pythonFlaskPreprocessReturnUnhandledVisitor,
  pythonFlaskSendFileMissingMimetypeVisitor,
  pythonFastapi204WithBodyVisitor,
  pythonFastapiChildRouterOrderVisitor,
  pythonFastapiUnusedPathParameterVisitor,
  pythonFastapiRedundantResponseModelVisitor,
  pythonLambdaNetworkCallNoTimeoutVisitor,
  pythonLambdaTmpNotCleanedVisitor,
  pythonPytorchNnModuleMissingSuperVisitor,
  pythonGenericErrorMessageVisitor,
  pythonNamedExprWithoutContextVisitor,
  pythonInvalidCharacterInSourceVisitor,
  pythonPostInitDefaultVisitor,
  pythonImplicitClassvarInDataclassVisitor,
  pythonConfusingImplicitConcatVisitor,
  pythonNumpyWeekmaskInvalidVisitor,
  pythonDatetimeConstructorRangeVisitor,
  pythonTfFunctionSideEffectsVisitor,
  pythonMlReductionAxisMissingVisitor,
  pythonPytestFixtureMisuseVisitor,
  pythonAirflowUsageErrorVisitor,
  pythonStarAssignmentErrorVisitor,
  pythonStaticKeyDictComprehensionRuffVisitor,
  pythonPytestRaisesAmbiguousPatternVisitor,
  pythonUsedDummyVariableVisitor,
  pythonFastapiCorsMiddlewareOrderVisitor,
  pythonDictIndexMissingItemsVisitor,
  pythonRegexAlternativesRedundantVisitor,
  pythonRegexLookaheadContradictoryVisitor,
  pythonRegexBoundaryUnmatchableVisitor,
  pythonRegexPossessiveAlwaysFailsVisitor,
  pythonEinopsPatternInvalidVisitor,
  pythonLambdaHandlerReturnsNonSerializableVisitor,
  pythonSklearnPipelineInvalidParamsVisitor,
  pythonForwardAnnotationSyntaxErrorVisitor,
  pythonRuntimeImportInTypeCheckingVisitor,
  pythonRedefinedSlotsInSubclassVisitor,
]
