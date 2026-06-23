using System.Collections.Generic;
using System.Linq;

namespace Positive.Boundary.Performance;

/// <summary>Reports whether any sample failed, short-circuiting on the first.</summary>
public sealed class ListComprehensionInAnyAllSafe
{
    private readonly List<Sample> _samples = new();

    /// <summary>Adds a sample to the tracked set.</summary>
    internal void Track(Sample sample)
    {
        _samples.Add(sample);
    }

    /// <summary>Returns true at the first distinct service without materializing.</summary>
    internal bool HasAnyService()
    {
        // SAFE: performance/deterministic/list-comprehension-in-any-all
        return _samples.Select(s => s.Service).Distinct().Any();
    }
}

/// <summary>Minimal sample record used by the boundary case.</summary>
public sealed class Sample
{
    /// <summary>Name of the service the sample belongs to.</summary>
    public string Service { get; init; } = string.Empty;
}
