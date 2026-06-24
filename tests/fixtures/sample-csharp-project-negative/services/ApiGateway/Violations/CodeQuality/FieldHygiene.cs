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

    // VIOLATION: code-quality/deterministic/outdated-base-type
    internal sealed class LegacyFieldFault : ApplicationException
    {
    }

    internal sealed class FieldKey
    {
        // VIOLATION: code-quality/deterministic/equality-operator-on-reference-type
        public static bool operator ==(FieldKey a, FieldKey b) => ReferenceEquals(a, b);
        public static bool operator !=(FieldKey a, FieldKey b) => !ReferenceEquals(a, b);
        // VIOLATION: code-quality/deterministic/inner-member-shadows-outer
        public override bool Equals(object obj) => ReferenceEquals(this, obj);
        public override int GetHashCode() => 0;
    }
}
