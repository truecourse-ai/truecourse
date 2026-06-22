namespace ApiGateway.Violations.Bugs;

internal sealed class AccountProfile
{
    // VIOLATION: code-quality/deterministic/mutable-private-member
    private string _displayName = string.Empty;
    private int _retryBudget;

    internal string DisplayName
    {
        get => _displayName;
        set
        {
            // VIOLATION: bugs/deterministic/property-assignment-in-own-setter
            DisplayName = value.Trim();
        }
    }

    internal int RetryBudget
    {
        get => _retryBudget;
        set
        {
            // VIOLATION: bugs/deterministic/unused-value-keyword-in-setter
            _retryBudget = 3;
        }
    }
}
