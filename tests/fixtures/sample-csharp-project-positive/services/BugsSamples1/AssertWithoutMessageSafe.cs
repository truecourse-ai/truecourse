using System.Diagnostics;

namespace Positive.Boundary.Bugs;

/// <summary>Checks a balance invariant with a descriptive assertion message.</summary>
public sealed class AssertWithoutMessageSafe
{
    private bool _checked;

    /// <summary>Asserts the balance is non-negative, supplying a context message.</summary>
    public void CheckBalance(decimal balance)
    {
        // SAFE: bugs/deterministic/assert-without-message
        Debug.Assert(balance >= 0, "balance must never be negative");
        _checked = true;
    }

    /// <summary>Whether a balance check has run.</summary>
    public bool HasChecked => _checked;
}
