// FP-GUARD: enum/no-code-counterpart — must NOT drift
// Paraphrase of a plugin/handler convention where each processor lives
// in its own */index.ts file and exports a default object with an `id`
// discriminant. No single module enumerates all processor kinds, so the
// extractor must synthesise a `processors` enum by walking the sibling
// id literals; without that synthesis the spec-side `ProcessorKind`
// enum would spuriously appear to have no code counterpart.
export default { id: 'batch', handle: (_payload: unknown) => null };
