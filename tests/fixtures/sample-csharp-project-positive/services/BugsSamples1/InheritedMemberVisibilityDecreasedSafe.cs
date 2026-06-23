namespace Positive.Boundary.Bugs;

/// <summary>Base handler exposing a public Start().</summary>
public class InheritedMemberVisibilityDecreasedSafeBase
{
    /// <summary>The retry budget the handler may spend.</summary>
    public int RetryBudget { get; protected set; } = 1;

    /// <summary>Starts the handler.</summary>
    public void Start()
    {
        RetryBudget = 1;
    }
}

/// <summary>Hides the base Start() with `new` while keeping the same public accessibility.</summary>
public sealed class InheritedMemberVisibilityDecreasedSafe : InheritedMemberVisibilityDecreasedSafeBase
{
    // SAFE: bugs/deterministic/inherited-member-visibility-decreased
    /// <summary>Starts the handler with a cleared budget.</summary>
    public new void Start()
    {
        RetryBudget = 0;
    }
}
