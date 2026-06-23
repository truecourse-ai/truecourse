namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Each branch is a single assignment — the trigger shape — but they assign to
/// <em>different</em> targets, so the if/else cannot collapse into one conditional
/// expression and the rule (which requires both arms to assign the same target)
/// must not fire.
/// </summary>
public sealed class IfElseInsteadOfTernarySafe
{
    /// <summary>Tracks how many times this router has run.</summary>
    private int _routeCount;

    /// <summary>How many times <see cref="Route"/> has been called on this instance.</summary>
    internal int RouteCount => _routeCount;

    /// <summary>Routes the count into one of two distinct fields and returns their sum.</summary>
    internal int Route(bool primary, int count, out int primaryTotal, out int backupTotal)
    {
        _routeCount++;
        primaryTotal = 0;
        backupTotal = 0;
        // SAFE: code-quality/deterministic/if-else-instead-of-ternary
        if (primary)
        {
            primaryTotal = count;
        }
        else
        {
            backupTotal = count;
        }
        return primaryTotal + backupTotal;
    }
}
