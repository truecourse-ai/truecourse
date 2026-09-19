/**
 * The four token buckets a turn is counted in, and how the AI SDK's own usage
 * shape maps onto them.
 *
 * `inputTokens` as the SDK reports it is the input TOTAL, so the fresh-input
 * bucket is the non-cached detail whenever the provider reports one; without
 * that detail the total stands in for it and the cache buckets read zero.
 */

/** One turn's token counts, in the same buckets the claude-code backend reports. */
export interface CallUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreateTokens: number
}

/** The AI SDK's usage block, as much of it as these buckets need. */
export interface SdkUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

/** Split the SDK's usage into the four non-overlapping buckets. */
export function callUsageOf(usage: SdkUsage | undefined): CallUsage {
  const details = usage?.inputTokenDetails
  return {
    inputTokens: details?.noCacheTokens ?? usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: details?.cacheReadTokens ?? 0,
    cacheCreateTokens: details?.cacheWriteTokens ?? 0,
  }
}
