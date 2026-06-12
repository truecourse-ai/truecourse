// Architecture FP-guard: forbidden-alternative from description-only contract.
//
// When an `architecture-decision` block contains only a free-form `decision "..."`
// field (no `category` or `chosen` keywords), the lifter defaults `chosen` to ''.
// The comparator then fires `forbidden-alternative` for every detected data-store
// alternative because any real value satisfies `observed_value != ''`.
//
// The contract `arch.fp-guard.description-only` exercises this shape. After the
// fix (`if (!chosen) return []`), no `forbidden-alternative` drift is emitted.
//
// FP-GUARD: architecture-decision/data-store-forbidden-alternative — must NOT drift
namespace SampleApi;

internal static class ArchitectureFpGuardForbiddenAlt
{
}
