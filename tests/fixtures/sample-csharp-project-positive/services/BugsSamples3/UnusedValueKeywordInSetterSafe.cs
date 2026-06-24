namespace Positive.Boundary.Bugs;

/// <summary>Holds a retry budget that is validated on assignment.</summary>
public sealed class UnusedValueKeywordInSetterSafe
{
    private int _retryBudget;

    /// <summary>The retry budget, clamped to a non-negative value on set.</summary>
    internal int RetryBudget
    {
        get => _retryBudget;
        set
        {
            // SAFE: bugs/deterministic/unused-value-keyword-in-setter
            _retryBudget = value;
            if (_retryBudget < 0)
            {
                _retryBudget = 0;
            }
        }
    }
}
