using System.Collections.Generic;

namespace ApiGateway.Violations.CodeQuality;

/// <summary>Holds request tags exposed with a replaceable setter.</summary>
internal sealed class RequestTagBag
{
    // A raw List exposed with a public setter — callers can swap the whole
    // collection wholesale and bypass any invariants (CA2227).
    // VIOLATION: code-quality/deterministic/writable-collection-property
    public List<string> Tags { get; set; } = new();
}
