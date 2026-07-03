/**
 * Positive fixture for security/deterministic/insecure-random.
 *
 * Math.random() drives probabilistic sampling here: for each metadata entry
 * it decides, via a coin flip weighted by the entry's sample rate, whether to
 * include that entry in the output. The random value never becomes a token,
 * key, or secret — it only gates whether an optional entry is emitted.
 *
 * The enclosing `for (const { key, value, sampleRate } of ... )` loop binds a
 * data field literally named `key`, but that is a map-entry name, not a
 * cryptographic key. Flagging the Math.random() call because an ancestor's
 * text happens to contain the word "key" is a false positive.
 */

interface MetadataEntry {
  key: string
  value: string
  sampleRate: number
}

export function collectSampledEntries(entries: readonly MetadataEntry[]): Record<string, string> {
  const selected: Record<string, string> = {}

  for (const { key, value, sampleRate } of entries) {
    if (sampleRate === 1) {
      selected[key] = value
      continue
    }

    if (Math.random() <= sampleRate) {
      selected[key] = value
    }
  }

  return selected
}
