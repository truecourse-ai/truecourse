using System;

namespace Positive.Boundary.Bugs;

/// <summary>Caps a requested timeout — the parameter is read, never overwritten.</summary>
public sealed class InitialValueOverwrittenSafe
{
    private readonly int _maxSeconds;

    /// <summary>Creates the policy with the given ceiling.</summary>
    public InitialValueOverwrittenSafe(int maxSeconds)
    {
        _maxSeconds = maxSeconds;
    }

    /// <summary>Returns the requested seconds capped at the configured maximum.</summary>
    // SAFE: bugs/deterministic/initial-value-overwritten
    internal int Clamp(int requestedSeconds) => Math.Min(requestedSeconds, _maxSeconds);
}
