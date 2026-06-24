using System;

namespace Positive.Boundary.Bugs;

/// <summary>Tracks a per-instance route while sharing a static start time.</summary>
public sealed class StaticFieldSetInConstructorSafe
{
    private static readonly int _startTick = Environment.TickCount;

    private readonly string _route;

    /// <summary>Creates the counter for the given route.</summary>
    public StaticFieldSetInConstructorSafe(string route)
    {
        // SAFE: bugs/deterministic/static-field-set-in-constructor
        _route = route;
    }

    /// <summary>Returns the route this counter tracks alongside the shared start tick.</summary>
    internal string Describe() => $"{_route}@{_startTick}";
}
