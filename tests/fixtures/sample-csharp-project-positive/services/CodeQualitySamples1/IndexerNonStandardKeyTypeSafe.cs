using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// An indexer keyed by <c>string</c> — a standard lookup key — so it reads as an
/// idiomatic lookup and the indexer-non-standard-key-type rule must not fire.
/// </summary>
public class IndexerNonStandardKeyTypeSafe
{
    private readonly Dictionary<string, decimal> _quotas = new();

    // SAFE: code-quality/deterministic/indexer-non-standard-key-type
    /// <summary>Looks up the quota for the named tier.</summary>
    public decimal this[string tier] => _quotas.TryGetValue(tier, out var q) ? q : 0m;
}
