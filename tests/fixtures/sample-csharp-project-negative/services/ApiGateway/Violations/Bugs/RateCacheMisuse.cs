using System.ComponentModel.Composition;

namespace ApiGateway.Violations.Bugs;

/// <summary>A shared MEF part that caches lookup counts for the whole composition.</summary>
[Export]
[PartCreationPolicy(CreationPolicy.Shared)]
internal sealed class RateCache
{
    /// <summary>Number of cache lookups served.</summary>
    public int Lookups { get; set; }
}

internal static class RateCacheMisuse
{
    /// <summary>Returns a rate cache for the caller.</summary>
    internal static RateCache Create()
    {
        // VIOLATION: bugs/deterministic/shared-part-created-with-new
        return new RateCache();
    }
}
