using System;

namespace Positive.Boundary.Performance;

/// <summary>Path prefix checks that test multi-character markers, not single chars.</summary>
public sealed class PreferCharOverloadSafe
{
    /// <summary>True when the path is a protocol-relative URL ("//host/...").</summary>
    internal bool IsProtocolRelative(string path)
    {
        // SAFE: performance/deterministic/prefer-char-overload
        return path.StartsWith("//", StringComparison.Ordinal);
    }
}
