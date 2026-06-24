using System;

namespace Positive.Boundary.Performance;

/// <summary>Returns an empty array via the shared cached singleton instead of allocating one.</summary>
public sealed class ZeroLengthArrayAllocationSafe
{
    /// <summary>Returns a shared empty string array.</summary>
    internal string[] None()
    {
        // SAFE: performance/deterministic/zero-length-array-allocation
        return Array.Empty<string>();
    }
}
