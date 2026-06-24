using System.Collections.Generic;

namespace Positive.Boundary.Performance;

/// <summary>Scales every latency total in place by iterating the keys.</summary>
public sealed class IncorrectDictIteratorSafe
{
    private readonly Dictionary<string, double> _totalsByService = new();

    /// <summary>Multiplies each stored total by the given factor in place.</summary>
    internal void Scale(double factor)
    {
        // SAFE: performance/deterministic/incorrect-dict-iterator
        foreach (var service in _totalsByService.Keys)
        {
            _totalsByService[service] = _totalsByService[service] * factor;
        }
    }
}
