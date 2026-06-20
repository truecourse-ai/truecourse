namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class FieldHygiene
{
    // VIOLATION: code-quality/deterministic/non-private-field
    public int RetryCount;

    // VIOLATION: code-quality/deterministic/static-readonly-should-be-const
    private static readonly int MaxRetries = 5;

    // VIOLATION: code-quality/deterministic/redundant-default-initializer
    private bool _disposed = false;

    internal int Total()
    {
        return RetryCount + MaxRetries + (_disposed ? 0 : 1);
    }

    internal void Close()
    {
        _disposed = true;
    }
}
