using System;
using System.Collections.Generic;

namespace ApiGateway.Violations.Performance;

internal sealed class Allocations
{
    private readonly List<string> _tags = new();

    internal bool IsAllowed(string method)
    {
        // VIOLATION: performance/deterministic/constant-array-argument
        return Array.IndexOf(new[] { "GET", "HEAD", "OPTIONS" }, method) >= 0;
    }

    internal void Reset(Span<byte> buffer)
    {
        // VIOLATION: performance/deterministic/span-fill-default-over-clear
        buffer.Fill(default);
    }

    // VIOLATION: performance/deterministic/property-returns-collection-copy
    // VIOLATION: code-quality/deterministic/property-returns-array
    public string[] Tags => _tags.ToArray();
}
