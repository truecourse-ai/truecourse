/**
 * Code quality domain Python visitors — re-exports all visitors
 * and assembles the combined array.
 */

import type { CodeRuleVisitor } from '../../../types.js'

import { pythonPrintVisitor } from './print.js'
import { pythonExplicitAnyVisitor } from './explicit-any.js'
import { pythonStarImportVisitor } from './star-import.js'
import { pythonGlobalStatementVisitor } from './global-statement.js'
import { pythonTooManyReturnStatementsVisitor } from './too-many-return-statements.js'
import { pythonCollapsibleIfVisitor } from './collapsible-if.js'
import { pythonNoEmptyFunctionVisitor } from './no-empty-function.js'
import { pythonUnnecessaryElseAfterReturnVisitor } from './unnecessary-else-after-return.js'
import { pythonCognitiveComplexityVisitor } from './cognitive-complexity.js'
import { pythonCyclomaticComplexityVisitor } from './cyclomatic-complexity.js'
import { pythonTooManyLinesVisitor } from './too-many-lines.js'
import { pythonTooManyBranchesVisitor } from './too-many-branches.js'
import { pythonDeeplyNestedFunctionsVisitor } from './deeply-nested-functions.js'
import { pythonDuplicateStringVisitor } from './duplicate-string.js'
import { pythonRedundantJumpVisitor } from './redundant-jump.js'
import { pythonNoDebuggerVisitor } from './no-debugger.js'
import { pythonRequireAwaitVisitor } from './require-await.js'
import { pythonUnusedVariableVisitor } from './unused-variable.js'
import { pythonCommentedOutCodeVisitor } from './commented-out-code.js'
import { pythonAbstractClassWithoutAbstractMethodVisitor } from './abstract-class-without-abstract-method.js'
import { pythonAndOrTernaryVisitor } from './and-or-ternary.js'
import { pythonAnyTypeHintVisitor } from './any-type-hint.js'
import { pythonAssertInProductionVisitor } from './assert-in-production.js'
import { pythonAsyncLongSleepVisitor } from './async-long-sleep.js'
import { pythonAsyncUnusedAsyncVisitor } from './async-unused-async.js'
import { pythonAsyncZeroSleepVisitor } from './async-zero-sleep.js'
import { pythonAwsCloudwatchNamespaceVisitor } from './aws-cloudwatch-namespace.js'
import { pythonAwsHardcodedRegionVisitor } from './aws-hardcoded-region.js'
import { pythonBadDunderMethodNameVisitor } from './bad-dunder-method-name.js'
import { pythonBareRaiseOutsideExceptVisitor } from './bare-raise-outside-except.js'
import { pythonBlanketTypeIgnoreVisitor } from './blanket-type-ignore.js'
import { pythonBooleanChainedComparisonVisitor } from './boolean-chained-comparison.js'
import { pythonBooleanTrapVisitor } from './boolean-trap.js'
import { pythonBoto3PaginationVisitor } from './boto3-pagination.js'
import { pythonBroadExceptionRaisedVisitor } from './broad-exception-raised.js'
import { pythonBuiltinShadowingVisitor } from './builtin-shadowing.js'
import { pythonCachedInstanceMethodVisitor } from './cached-instance-method.js'
import { pythonClassAsDataStructureVisitor } from './class-as-data-structure.js'
import { pythonCollectionLiteralConcatenationVisitor } from './collection-literal-concatenation.js'
import { pythonCompareToEmptyStringVisitor } from './compare-to-empty-string.js'
import { pythonCompareWithTupleVisitor } from './compare-with-tuple.js'
import { pythonComparisonOfConstantVisitor } from './comparison-of-constant.js'
import { pythonConfusingTypeCheckVisitor } from './confusing-type-check.js'
import { pythonContradictoryBooleanExpressionVisitor } from './contradictory-boolean-expression.js'
import { pythonDictGetNoneDefaultVisitor } from './dict-get-none-default.js'
import { pythonDjangoLocalsInRenderVisitor } from './django-locals-in-render.js'
import { pythonDjangoModelFormFieldsVisitor } from './django-model-form-fields.js'
import { pythonDjangoModelWithoutStrVisitor } from './django-model-without-str.js'
import { pythonDjangoNullableStringFieldVisitor } from './django-nullable-string-field.js'
import { pythonDjangoReceiverDecoratorOrderVisitor } from './django-receiver-decorator-order.js'
import { pythonDoubleNegationVisitor } from './double-negation.js'
import { pythonDuplicateClassFieldVisitor } from './duplicate-class-field.js'
import { pythonDuplicateIsinstanceCallVisitor } from './duplicate-isinstance-call.js'
import { pythonEmptyMethodWithoutAbstractVisitor } from './empty-method-without-abstract.js'
import { pythonEmptyTypeCheckingBlockVisitor } from './empty-type-checking-block.js'
import { pythonEnumerateForLoopVisitor } from './enumerate-for-loop.js'
import { pythonEqWithoutHashVisitor } from './eq-without-hash.js'
import { pythonErrorInsteadOfExceptionVisitor } from './error-instead-of-exception.js'
import { pythonExceptionBaseClassVisitor } from './exception-base-class.js'
import { pythonExplicitFstringConversionVisitor } from './explicit-fstring-conversion.js'
import { pythonFastapiGenericRouteDecoratorVisitor } from './fastapi-generic-route-decorator.js'
import { pythonFastapiNonAnnotatedDependencyVisitor } from './fastapi-non-annotated-dependency.js'
import { pythonFastapiRouterPrefixVisitor } from './fastapi-router-prefix.js'
import { pythonFieldDuplicatesClassNameVisitor } from './field-duplicates-class-name.js'
import { pythonFlaskRestVerbAnnotationVisitor } from './flask-rest-verb-annotation.js'
import { pythonGenericTypeUnparameterizedVisitor } from './generic-type-unparameterized.js'
import { pythonGetattrWithConstantVisitor } from './getattr-with-constant.js'
import { pythonIfElseDictLookupVisitor } from './if-else-dict-lookup.js'
import { pythonIfElseInsteadOfDictGetVisitor } from './if-else-instead-of-dict-get.js'
import { pythonIfElseInsteadOfTernaryVisitor } from './if-else-instead-of-ternary.js'
import { pythonIfExprMinMaxVisitor } from './if-expr-min-max.js'
import { pythonIfWithSameArmsVisitor } from './if-with-same-arms.js'
import { pythonImplicitReturnVisitor } from './implicit-return.js'
import { pythonImplicitStringConcatenationVisitor } from './implicit-string-concatenation.js'
import { pythonImportOutsideTopLevelVisitor } from './import-outside-top-level.js'
import { pythonImportPrivateNameVisitor } from './import-private-name.js'
import { pythonInDictKeysVisitor } from './in-dict-keys.js'
import { pythonInvalidEscapeSequenceVisitor } from './invalid-escape-sequence.js'
import { pythonIsinstanceTypeNoneVisitor } from './isinstance-type-none.js'
import { pythonIterationOverSetVisitor } from './iteration-over-set.js'
import { pythonLambdaAsyncHandlerVisitor } from './lambda-async-handler.js'
import { pythonLegacyTypeHintSyntaxVisitor } from './legacy-type-hint-syntax.js'
import { pythonLenTestVisitor } from './len-test.js'
import { pythonLiteralMembershipTestVisitor } from './literal-membership-test.js'
import { pythonLoggingDirectInstantiationVisitor } from './logging-direct-instantiation.js'
import { pythonLoggingExcInfoVisitor } from './logging-exc-info.js'
import { pythonLoggingExtraAttrClashVisitor } from './logging-extra-attr-clash.js'
import { pythonLoggingRedundantExcInfoVisitor } from './logging-redundant-exc-info.js'
import { pythonLoggingRootLoggerCallVisitor } from './logging-root-logger-call.js'
import { pythonLoggingStringFormatVisitor } from './logging-string-format.js'
import { pythonMagicValueComparisonVisitor } from './magic-value-comparison.js'
import { pythonMapIntVersionParsingVisitor } from './map-int-version-parsing.js'
import { pythonMetaclassABCMetaVisitor } from './metaclass-abcmeta.js'
import { pythonMissingTypeHintsVisitor } from './missing-type-hints.js'
import { pythonMultipleWithStatementsVisitor } from './multiple-with-statements.js'
import { pythonNeedlessBoolVisitor } from './needless-bool.js'
import { pythonNeedlessElseVisitor } from './needless-else.js'
import { pythonNegatedComparisonVisitor } from './negated-comparison.js'
import { pythonNestedMinMaxVisitor } from './nested-min-max.js'
import { pythonNoSelfUseVisitor } from './no-self-use.js'
import { pythonNonAugmentedAssignmentVisitor } from './non-augmented-assignment.js'
import { pythonNonUniqueEnumValuesVisitor } from './non-unique-enum-values.js'
import { pythonNumpyDeprecatedTypeAliasVisitor } from './numpy-deprecated-type-alias.js'
import { pythonNumpyLegacyRandomVisitor } from './numpy-legacy-random.js'
import { pythonNumpyListToArrayVisitor } from './numpy-list-to-array.js'
import { pythonNumpyNonzeroPreferredVisitor } from './numpy-nonzero-preferred.js'
import { pythonOpenFileWithoutContextManagerVisitor } from './open-file-without-context-manager.js'
import { pythonPandasDeprecatedAccessorVisitor } from './pandas-deprecated-accessor.js'
import { pythonPandasInplaceArgumentVisitor } from './pandas-inplace-argument.js'
import { pythonPandasReadCsvDtypeVisitor } from './pandas-read-csv-dtype.js'
import { pythonPandasUseOfDotValuesVisitor } from './pandas-use-of-dot-values.js'
import { pythonPprintUsageVisitor } from './pprint-usage.js'
import { pythonPreferPathlibVisitor } from './prefer-pathlib.js'
import { pythonPrintEmptyStringVisitor } from './print-empty-string.js'
import { pythonPrintStatementInProductionVisitor } from './print-statement-in-production.js'
import { pythonPrivateMemberAccessVisitor } from './private-member-access.js'
import { pythonPropertyWithParametersVisitor } from './property-with-parameters.js'
import { pythonPydanticOptionalDefaultVisitor } from './pydantic-optional-default.js'
import { pythonPytestAssertInExceptVisitor } from './pytest-assert-in-except.js'
import { pythonPytestCompositeAssertionVisitor } from './pytest-composite-assertion.js'
import { pythonPytestFailWithoutMessageVisitor } from './pytest-fail-without-message.js'
import { pythonPytestRaisesMultipleStatementsVisitor } from './pytest-raises-multiple-statements.js'
import { pythonPytestUnittestAssertionVisitor } from './pytest-unittest-assertion.js'
import { pythonPytestWarnsIssuesVisitor } from './pytest-warns-issues.js'
import { pythonPytzDeprecatedVisitor } from './pytz-deprecated.js'
import { pythonRaiseVanillaArgsVisitor } from './raise-vanilla-args.js'
import { pythonRaiseWithinTryVisitor } from './raise-within-try.js'
import { pythonRawStringInExceptionVisitor } from './raw-string-in-exception.js'
import { pythonReadWriteWholeFileVisitor } from './read-write-whole-file.js'
import { pythonReadlinesInForVisitor } from './readlines-in-for.js'
import { pythonRedefinedLoopNameVisitor } from './redefined-loop-name.js'
import { pythonRedundantCollectionFunctionVisitor } from './redundant-collection-function.js'
import { pythonReimplementedBuiltinVisitor } from './reimplemented-builtin.js'
import { pythonReimplementedContainerBuiltinVisitor } from './reimplemented-container-builtin.js'
import { pythonReimplementedOperatorVisitor } from './reimplemented-operator.js'
import { pythonRepeatedAppendVisitor } from './repeated-append.js'
import { pythonReturnNotImplementedVisitor } from './return-not-implemented.js'
import { pythonSelfFirstArgumentVisitor } from './self-first-argument.js'
import { pythonSklearnPipelineMemoryVisitor } from './sklearn-pipeline-memory.js'
import { pythonSliceToRemovePrefixSuffixVisitor } from './slice-to-remove-prefix-suffix.js'
import { pythonSortedReversedRedundantVisitor } from './sorted-reversed-redundant.js'
import { pythonSplitStaticStringVisitor } from './split-static-string.js'
import { pythonStarmapZipSimplificationVisitor } from './starmap-zip-simplification.js'
import { pythonStartswithEndswithTupleVisitor } from './startswith-endswith-tuple.js'
import { pythonStaticJoinToFstringVisitor } from './static-join-to-fstring.js'
import { pythonStopIterationInGeneratorVisitor } from './stop-iteration-in-generator.js'
import { pythonSubclassBuiltinCollectionVisitor } from './subclass-builtin-collection.js'
import { pythonSubprocessRunWithoutCheckVisitor } from './subprocess-run-without-check.js'
import { pythonSuperfluousElseAfterControlVisitor } from './superfluous-else-after-control.js'
import { pythonSuppressibleExceptionVisitor } from './suppressible-exception.js'
import { pythonSwapVariablesPythonicVisitor } from './swap-variables-pythonic.js'
import { pythonSysExitAliasVisitor } from './sys-exit-alias.js'
import { pythonSystemExitNotReraisedVisitor } from './system-exit-not-reraised.js'
import { pythonTfGatherValidateIndicesVisitor } from './tf-gather-validate-indices.js'
import { pythonTooManyBooleanExpressionsVisitor } from './too-many-boolean-expressions.js'
import { pythonTooManyLocalsVisitor } from './too-many-locals.js'
import { pythonTooManyNestedBlocksVisitor } from './too-many-nested-blocks.js'
import { pythonTooManyPositionalArgumentsVisitor } from './too-many-positional-arguments.js'
import { pythonTooManyPublicMethodsVisitor } from './too-many-public-methods.js'
import { pythonTooManyStatementsVisitor } from './too-many-statements.js'
import { pythonTorchAutogradVariableVisitor } from './torch-autograd-variable.js'
import { pythonTryConsiderElseVisitor } from './try-consider-else.js'
import { pythonTryExceptContinueVisitor } from './try-except-continue.js'
import { pythonTryExceptPassVisitor } from './try-except-pass.js'
import { pythonTypeCheckWithoutTypeErrorVisitor } from './type-check-without-type-error.js'
import { pythonUnconditionalAssertionVisitor } from './unconditional-assertion.js'
import { pythonUnittestSpecificAssertionVisitor } from './unittest-specific-assertion.js'
import { pythonUnnecessaryAssignBeforeReturnVisitor } from './unnecessary-assign-before-return.js'
import { pythonUnnecessaryDictKwargsVisitor } from './unnecessary-dict-kwargs.js'
import { pythonUnnecessaryDictSpreadVisitor } from './unnecessary-dict-spread.js'
import { pythonUnnecessaryDirectLambdaCallVisitor } from './unnecessary-direct-lambda-call.js'
import { pythonUnnecessaryDunderCallVisitor } from './unnecessary-dunder-call.js'
import { pythonUnnecessaryEmptyIterableInDequeVisitor } from './unnecessary-empty-iterable-in-deque.js'
import { pythonUnnecessaryGeneratorComprehensionVisitor } from './unnecessary-generator-comprehension.js'
import { pythonUnnecessaryLambdaVisitor } from './unnecessary-lambda.js'
import { pythonUnnecessaryListInIterationVisitor } from './unnecessary-list-in-iteration.js'
import { pythonUnnecessaryPassVisitor } from './unnecessary-pass.js'
import { pythonUnnecessaryPlaceholderStatementVisitor } from './unnecessary-placeholder-statement.js'
import { pythonUnnecessaryRangeStartVisitor } from './unnecessary-range-start.js'
import { pythonUnnecessaryRegularExpressionVisitor } from './unnecessary-regular-expression.js'
import { pythonUnspecifiedEncodingVisitor } from './unspecified-encoding.js'
import { pythonUnusedUnpackedVariableVisitor } from './unused-unpacked-variable.js'
import { pythonUseBitCountVisitor } from './use-bit-count.js'
import { pythonUseDecoratorSyntaxVisitor } from './use-decorator-syntax.js'
import { pythonUselessElseOnLoopVisitor } from './useless-else-on-loop.js'
import { pythonUselessExpressionVisitor } from './useless-expression.js'
import { pythonUselessIfElseVisitor } from './useless-if-else.js'
import { pythonUselessImportAliasVisitor } from './useless-import-alias.js'
import { pythonUselessTryExceptVisitor } from './useless-try-except.js'
import { pythonUselessWithLockVisitor } from './useless-with-lock.js'
import { pythonVerboseLogMessageVisitor } from './verbose-log-message.js'
import { pythonVerboseRaiseVisitor } from './verbose-raise.js'
import { pythonYodaConditionVisitor } from './yoda-condition.js'
import { pythonZipDictKeysValuesVisitor } from './zip-dict-keys-values.js'
import { pythonZipInsteadOfPairwiseVisitor } from './zip-instead-of-pairwise.js'
import { pythonPytestSuboptimalPatternVisitor } from './pytest-suboptimal-pattern.js'
import { pythonIdiomSimplificationVisitor } from './python-idiom-simplification.js'
import { pythonManualFromImportVisitor } from './manual-from-import.js'
import { pythonFutureAnnotationsImportVisitor } from './future-annotations-import.js'
import { pythonPyupgradeModernizationVisitor } from './pyupgrade-modernization.js'
import { pythonPandasAccessorPreferenceVisitor } from './pandas-accessor-preference.js'
import { pythonNonEmptyInitModuleVisitor } from './non-empty-init-module.js'
import { pythonUnusedAnnotationVisitor } from './unused-annotation.js'
import { pythonDuplicateUnionLiteralMemberVisitor } from './duplicate-union-literal-member.js'
import { pythonUnnecessaryTypeUnionVisitor } from './unnecessary-type-union.js'
import { pythonUnnecessaryCastToIntVisitor } from './unnecessary-cast-to-int.js'
import { pythonUnnecessaryRoundVisitor } from './unnecessary-round.js'
import { pythonAsyncSingleTaskGroupVisitor } from './async-single-task-group.js'
import { pythonCheckAndRemoveFromSetVisitor } from './check-and-remove-from-set.js'
import { pythonPandasMergeParametersVisitor } from './pandas-merge-parameters.js'
import { pythonPytestDuplicateParametrizeVisitor } from './pytest-duplicate-parametrize.js'
import { pythonUnnecessaryDictIndexLookupVisitor } from './unnecessary-dict-index-lookup.js'
import { pythonUnnecessaryListIndexLookupVisitor } from './unnecessary-list-index-lookup.js'
import { pythonGlobalVariableNotAssignedVisitor } from './global-variable-not-assigned.js'
import { pythonRedeclaredAssignedNameVisitor } from './redeclared-assigned-name.js'
import { pythonMissingMaxsplitArgVisitor } from './missing-maxsplit-arg.js'
import { pythonAmbiguousUnicodeCharacterVisitor } from './ambiguous-unicode-character.js'
import { pythonUnnecessaryKeyCheckVisitor } from './unnecessary-key-check.js'
import { pythonDjangoUnorderedBodyContentVisitor } from './django-unordered-body-content.js'
import { pythonTestNotDiscoverableVisitor } from './test-not-discoverable.js'
import { pythonTestSkippedImplicitlyVisitor } from './test-skipped-implicitly.js'
import { pythonRegexCharClassPreferredVisitor } from './regex-char-class-preferred.js'
import { pythonRegexUnnecessaryNonCapturingGroupVisitor } from './regex-unnecessary-non-capturing-group.js'
import { pythonRegexSuperfluousQuantifierVisitor } from './regex-superfluous-quantifier.js'
import { pythonRegexOctalEscapeVisitor } from './regex-octal-escape.js'
import { pythonLegacyGenericSyntaxVisitor } from './legacy-generic-syntax.js'
import { pythonDeeplyNestedFstringVisitor } from './deeply-nested-fstring.js'
import { pythonNumpyReproducibleRandomVisitor } from './numpy-reproducible-random.js'
import { pythonPandasPipePreferredVisitor } from './pandas-pipe-preferred.js'
import { pythonPandasDatetimeFormatVisitor } from './pandas-datetime-format.js'
import { pythonTfFunctionRecursiveVisitor } from './tf-function-recursive.js'
import { pythonTfFunctionGlobalVariableVisitor } from './tf-function-global-variable.js'
import { pythonTfVariableSingletonVisitor } from './tf-variable-singleton.js'
import { pythonTfKerasInputShapeVisitor } from './tf-keras-input-shape.js'
import { pythonMlMissingHyperparametersVisitor } from './ml-missing-hyperparameters.js'
import { pythonTorchModelEvalTrainVisitor } from './torch-model-eval-train.js'
import { pythonLambdaInitResourcesVisitor } from './lambda-init-resources.js'
import { pythonLambdaSyncInvocationVisitor } from './lambda-sync-invocation.js'
import { pythonLambdaReservedEnvVarVisitor } from './lambda-reserved-env-var.js'
import { pythonBoto3ClientErrorVisitor } from './boto3-client-error.js'
import { pythonAwsCustomPollingVisitor } from './aws-custom-polling.js'
import { pythonFastapiImportStringVisitor } from './fastapi-import-string.js'
import { pythonFastapiTestclientContentVisitor } from './fastapi-testclient-content.js'
import { pythonFastapiUndocumentedExceptionVisitor } from './fastapi-undocumented-exception.js'
import { pythonDictFromkeysForConstantVisitor } from './dict-fromkeys-for-constant.js'
import { pythonCompressionNamespaceImportVisitor } from './compression-namespace-import.js'
import { pythonTypingOnlyImportVisitor } from './typing-only-import.js'
import { pythonBannedApiImportVisitor } from './banned-api-import.js'
import { pythonAirflow3MigrationVisitor } from './airflow-3-migration.js'
import { pythonReturnTypeInconsistentWithHintVisitor } from './return-type-inconsistent-with-hint.js'
import { pythonAssignmentInconsistentWithHintVisitor } from './assignment-inconsistent-with-hint.js'

export const CODE_QUALITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonPrintVisitor,
  pythonExplicitAnyVisitor,
  pythonStarImportVisitor,
  pythonGlobalStatementVisitor,
  pythonTooManyReturnStatementsVisitor,
  pythonCollapsibleIfVisitor,
  pythonNoEmptyFunctionVisitor,
  pythonUnnecessaryElseAfterReturnVisitor,
  pythonCognitiveComplexityVisitor,
  pythonCyclomaticComplexityVisitor,
  pythonTooManyLinesVisitor,
  pythonTooManyBranchesVisitor,
  pythonDeeplyNestedFunctionsVisitor,
  pythonDuplicateStringVisitor,
  pythonRedundantJumpVisitor,
  pythonNoDebuggerVisitor,
  pythonRequireAwaitVisitor,
  pythonUnusedVariableVisitor,
  pythonCommentedOutCodeVisitor,
  pythonAbstractClassWithoutAbstractMethodVisitor,
  pythonAndOrTernaryVisitor,
  pythonAnyTypeHintVisitor,
  pythonAssertInProductionVisitor,
  pythonAsyncLongSleepVisitor,
  pythonAsyncUnusedAsyncVisitor,
  pythonAsyncZeroSleepVisitor,
  pythonAwsCloudwatchNamespaceVisitor,
  pythonAwsHardcodedRegionVisitor,
  pythonBadDunderMethodNameVisitor,
  pythonBareRaiseOutsideExceptVisitor,
  pythonBlanketTypeIgnoreVisitor,
  pythonBooleanChainedComparisonVisitor,
  pythonBooleanTrapVisitor,
  pythonBoto3PaginationVisitor,
  pythonBroadExceptionRaisedVisitor,
  pythonBuiltinShadowingVisitor,
  pythonCachedInstanceMethodVisitor,
  pythonClassAsDataStructureVisitor,
  pythonCollectionLiteralConcatenationVisitor,
  pythonCompareToEmptyStringVisitor,
  pythonCompareWithTupleVisitor,
  pythonComparisonOfConstantVisitor,
  pythonConfusingTypeCheckVisitor,
  pythonContradictoryBooleanExpressionVisitor,
  pythonDictGetNoneDefaultVisitor,
  pythonDjangoLocalsInRenderVisitor,
  pythonDjangoModelFormFieldsVisitor,
  pythonDjangoModelWithoutStrVisitor,
  pythonDjangoNullableStringFieldVisitor,
  pythonDjangoReceiverDecoratorOrderVisitor,
  pythonDoubleNegationVisitor,
  pythonDuplicateClassFieldVisitor,
  pythonDuplicateIsinstanceCallVisitor,
  pythonEmptyMethodWithoutAbstractVisitor,
  pythonEmptyTypeCheckingBlockVisitor,
  pythonEnumerateForLoopVisitor,
  pythonEqWithoutHashVisitor,
  pythonErrorInsteadOfExceptionVisitor,
  pythonExceptionBaseClassVisitor,
  pythonExplicitFstringConversionVisitor,
  pythonFastapiGenericRouteDecoratorVisitor,
  pythonFastapiNonAnnotatedDependencyVisitor,
  pythonFastapiRouterPrefixVisitor,
  pythonFieldDuplicatesClassNameVisitor,
  pythonFlaskRestVerbAnnotationVisitor,
  pythonGenericTypeUnparameterizedVisitor,
  pythonGetattrWithConstantVisitor,
  pythonIfElseDictLookupVisitor,
  pythonIfElseInsteadOfDictGetVisitor,
  pythonIfElseInsteadOfTernaryVisitor,
  pythonIfExprMinMaxVisitor,
  pythonIfWithSameArmsVisitor,
  pythonImplicitReturnVisitor,
  pythonImplicitStringConcatenationVisitor,
  pythonImportOutsideTopLevelVisitor,
  pythonImportPrivateNameVisitor,
  pythonInDictKeysVisitor,
  pythonInvalidEscapeSequenceVisitor,
  pythonIsinstanceTypeNoneVisitor,
  pythonIterationOverSetVisitor,
  pythonLambdaAsyncHandlerVisitor,
  pythonLegacyTypeHintSyntaxVisitor,
  pythonLenTestVisitor,
  pythonLiteralMembershipTestVisitor,
  pythonLoggingDirectInstantiationVisitor,
  pythonLoggingExcInfoVisitor,
  pythonLoggingExtraAttrClashVisitor,
  pythonLoggingRedundantExcInfoVisitor,
  pythonLoggingRootLoggerCallVisitor,
  pythonLoggingStringFormatVisitor,
  pythonMagicValueComparisonVisitor,
  pythonMapIntVersionParsingVisitor,
  pythonMetaclassABCMetaVisitor,
  pythonMissingTypeHintsVisitor,
  pythonMultipleWithStatementsVisitor,
  pythonNeedlessBoolVisitor,
  pythonNeedlessElseVisitor,
  pythonNegatedComparisonVisitor,
  pythonNestedMinMaxVisitor,
  pythonNoSelfUseVisitor,
  pythonNonAugmentedAssignmentVisitor,
  pythonNonUniqueEnumValuesVisitor,
  pythonNumpyDeprecatedTypeAliasVisitor,
  pythonNumpyLegacyRandomVisitor,
  pythonNumpyListToArrayVisitor,
  pythonNumpyNonzeroPreferredVisitor,
  pythonOpenFileWithoutContextManagerVisitor,
  pythonPandasDeprecatedAccessorVisitor,
  pythonPandasInplaceArgumentVisitor,
  pythonPandasReadCsvDtypeVisitor,
  pythonPandasUseOfDotValuesVisitor,
  pythonPprintUsageVisitor,
  pythonPreferPathlibVisitor,
  pythonPrintEmptyStringVisitor,
  pythonPrintStatementInProductionVisitor,
  pythonPrivateMemberAccessVisitor,
  pythonPropertyWithParametersVisitor,
  pythonPydanticOptionalDefaultVisitor,
  pythonPytestAssertInExceptVisitor,
  pythonPytestCompositeAssertionVisitor,
  pythonPytestFailWithoutMessageVisitor,
  pythonPytestRaisesMultipleStatementsVisitor,
  pythonPytestUnittestAssertionVisitor,
  pythonPytestWarnsIssuesVisitor,
  pythonPytzDeprecatedVisitor,
  pythonRaiseVanillaArgsVisitor,
  pythonRaiseWithinTryVisitor,
  pythonRawStringInExceptionVisitor,
  pythonReadWriteWholeFileVisitor,
  pythonReadlinesInForVisitor,
  pythonRedefinedLoopNameVisitor,
  pythonRedundantCollectionFunctionVisitor,
  pythonReimplementedBuiltinVisitor,
  pythonReimplementedContainerBuiltinVisitor,
  pythonReimplementedOperatorVisitor,
  pythonRepeatedAppendVisitor,
  pythonReturnNotImplementedVisitor,
  pythonSelfFirstArgumentVisitor,
  pythonSklearnPipelineMemoryVisitor,
  pythonSliceToRemovePrefixSuffixVisitor,
  pythonSortedReversedRedundantVisitor,
  pythonSplitStaticStringVisitor,
  pythonStarmapZipSimplificationVisitor,
  pythonStartswithEndswithTupleVisitor,
  pythonStaticJoinToFstringVisitor,
  pythonStopIterationInGeneratorVisitor,
  pythonSubclassBuiltinCollectionVisitor,
  pythonSubprocessRunWithoutCheckVisitor,
  pythonSuperfluousElseAfterControlVisitor,
  pythonSuppressibleExceptionVisitor,
  pythonSwapVariablesPythonicVisitor,
  pythonSysExitAliasVisitor,
  pythonSystemExitNotReraisedVisitor,
  pythonTfGatherValidateIndicesVisitor,
  pythonTooManyBooleanExpressionsVisitor,
  pythonTooManyLocalsVisitor,
  pythonTooManyNestedBlocksVisitor,
  pythonTooManyPositionalArgumentsVisitor,
  pythonTooManyPublicMethodsVisitor,
  pythonTooManyStatementsVisitor,
  pythonTorchAutogradVariableVisitor,
  pythonTryConsiderElseVisitor,
  pythonTryExceptContinueVisitor,
  pythonTryExceptPassVisitor,
  pythonTypeCheckWithoutTypeErrorVisitor,
  pythonUnconditionalAssertionVisitor,
  pythonUnittestSpecificAssertionVisitor,
  pythonUnnecessaryAssignBeforeReturnVisitor,
  pythonUnnecessaryDictKwargsVisitor,
  pythonUnnecessaryDictSpreadVisitor,
  pythonUnnecessaryDirectLambdaCallVisitor,
  pythonUnnecessaryDunderCallVisitor,
  pythonUnnecessaryEmptyIterableInDequeVisitor,
  pythonUnnecessaryGeneratorComprehensionVisitor,
  pythonUnnecessaryLambdaVisitor,
  pythonUnnecessaryListInIterationVisitor,
  pythonUnnecessaryPassVisitor,
  pythonUnnecessaryPlaceholderStatementVisitor,
  pythonUnnecessaryRangeStartVisitor,
  pythonUnnecessaryRegularExpressionVisitor,
  pythonUnspecifiedEncodingVisitor,
  pythonUnusedUnpackedVariableVisitor,
  pythonUseBitCountVisitor,
  pythonUseDecoratorSyntaxVisitor,
  pythonUselessElseOnLoopVisitor,
  pythonUselessExpressionVisitor,
  pythonUselessIfElseVisitor,
  pythonUselessImportAliasVisitor,
  pythonUselessTryExceptVisitor,
  pythonUselessWithLockVisitor,
  pythonVerboseLogMessageVisitor,
  pythonVerboseRaiseVisitor,
  pythonYodaConditionVisitor,
  pythonZipDictKeysValuesVisitor,
  pythonZipInsteadOfPairwiseVisitor,
  pythonPytestSuboptimalPatternVisitor,
  pythonIdiomSimplificationVisitor,
  pythonManualFromImportVisitor,
  pythonFutureAnnotationsImportVisitor,
  pythonPyupgradeModernizationVisitor,
  pythonPandasAccessorPreferenceVisitor,
  pythonNonEmptyInitModuleVisitor,
  pythonUnusedAnnotationVisitor,
  pythonDuplicateUnionLiteralMemberVisitor,
  pythonUnnecessaryTypeUnionVisitor,
  pythonUnnecessaryCastToIntVisitor,
  pythonUnnecessaryRoundVisitor,
  // Batch — first half of remaining new rules
  pythonAsyncSingleTaskGroupVisitor,
  pythonCheckAndRemoveFromSetVisitor,
  pythonPandasMergeParametersVisitor,
  pythonPytestDuplicateParametrizeVisitor,
  pythonUnnecessaryDictIndexLookupVisitor,
  pythonUnnecessaryListIndexLookupVisitor,
  pythonGlobalVariableNotAssignedVisitor,
  pythonRedeclaredAssignedNameVisitor,
  pythonMissingMaxsplitArgVisitor,
  pythonAmbiguousUnicodeCharacterVisitor,
  pythonUnnecessaryKeyCheckVisitor,
  pythonDjangoUnorderedBodyContentVisitor,
  pythonTestNotDiscoverableVisitor,
  pythonTestSkippedImplicitlyVisitor,
  pythonRegexCharClassPreferredVisitor,
  pythonRegexUnnecessaryNonCapturingGroupVisitor,
  pythonRegexSuperfluousQuantifierVisitor,
  pythonRegexOctalEscapeVisitor,
  pythonLegacyGenericSyntaxVisitor,
  pythonDeeplyNestedFstringVisitor,
  pythonNumpyReproducibleRandomVisitor,
  pythonPandasPipePreferredVisitor,
  pythonPandasDatetimeFormatVisitor,
  pythonTfFunctionRecursiveVisitor,
  pythonTfFunctionGlobalVariableVisitor,
  pythonTfVariableSingletonVisitor,
  pythonTfKerasInputShapeVisitor,
  pythonMlMissingHyperparametersVisitor,
  pythonTorchModelEvalTrainVisitor,
  pythonLambdaInitResourcesVisitor,
  pythonLambdaSyncInvocationVisitor,
  pythonLambdaReservedEnvVarVisitor,
  pythonBoto3ClientErrorVisitor,
  pythonAwsCustomPollingVisitor,
  pythonFastapiImportStringVisitor,
  pythonFastapiTestclientContentVisitor,
  pythonFastapiUndocumentedExceptionVisitor,
  pythonDictFromkeysForConstantVisitor,
  pythonCompressionNamespaceImportVisitor,
  pythonTypingOnlyImportVisitor,
  pythonBannedApiImportVisitor,
  pythonAirflow3MigrationVisitor,
  // Python type-aware rules (heuristic-based)
  pythonReturnTypeInconsistentWithHintVisitor,
  pythonAssignmentInconsistentWithHintVisitor,
]
