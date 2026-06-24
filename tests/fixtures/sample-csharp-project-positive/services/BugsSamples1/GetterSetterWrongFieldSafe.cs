using System;

namespace Positive.Boundary.Bugs;

/// <summary>A session with a hand-written TTL property backed by one field.</summary>
public sealed class GetterSetterWrongFieldSafe
{
    private int _ttlSeconds;

    /// <summary>Time-to-live in seconds; getter and setter share one field.</summary>
    internal int Ttl
    {
        // SAFE: bugs/deterministic/getter-setter-wrong-field
        get { return _ttlSeconds; }
        set { _ttlSeconds = Math.Max(0, value); }
    }
}
