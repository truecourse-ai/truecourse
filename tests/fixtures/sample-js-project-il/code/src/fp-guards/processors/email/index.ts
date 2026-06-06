// FP-GUARD: enum/no-code-counterpart — ProcessorKind must NOT report no-code-counterpart
// Each processor module exports a default object with an `id` string; the extractor
// synthesises these sibling id-literals into a single `processors` enum candidate,
// which the comparator then matches to the ProcessorKind contract by value-set.
export default { id: 'batch', handle: (_payload: unknown) => null };
