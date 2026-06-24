using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Exposes the Unix epoch via the framework field.</summary>
public sealed class PreferUnixEpochFieldSafe
{
    /// <summary>Returns midnight at the start of the Unix epoch in UTC.</summary>
    internal DateTime Epoch()
    {
        // SAFE: code-quality/deterministic/prefer-unix-epoch-field
        return DateTime.UnixEpoch;
    }
}
