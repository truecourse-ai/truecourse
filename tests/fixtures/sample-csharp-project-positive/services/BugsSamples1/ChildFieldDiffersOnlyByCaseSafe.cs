namespace Positive.Boundary.Bugs;

/// <summary>Base channel exposing the retry budget as a property.</summary>
public class ChildFieldDiffersOnlyByCaseSafe
{
    /// <summary>Number of retries the base permits.</summary>
    public int RetryBudget { get; protected set; }

    /// <summary>Returns the configured retry budget.</summary>
    public int CurrentBudget() => RetryBudget;
}

/// <summary>
/// Derived channel whose private field reads like the inherited <c>RetryBudget</c>
/// only differing by case. Because the inherited member is a property and not a
/// field, there is no field-to-field case-only clash to confuse.
/// </summary>
internal sealed class BackoffChannel : ChildFieldDiffersOnlyByCaseSafe
{
    // SAFE: bugs/deterministic/child-field-differs-only-by-case
    private int _retrybudget;

    /// <summary>Records the local budget and reports the combined total.</summary>
    internal int Configure(int budget)
    {
        _retrybudget = budget;
        return _retrybudget + RetryBudget;
    }
}
