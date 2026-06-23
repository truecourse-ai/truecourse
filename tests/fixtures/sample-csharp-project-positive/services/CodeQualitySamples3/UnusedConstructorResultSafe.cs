namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Constructs an audit scope and binds it to a local that is then used, so the
/// constructor result is not discarded and the rule must not fire.
/// </summary>
public sealed class UnusedConstructorResultSafe
{
    /// <summary>Opens an audit scope for the operation and returns its label.</summary>
    internal string Open(string operationName)
    {
        // SAFE: code-quality/deterministic/unused-constructor-result
        var scope = new AuditScope(operationName);
        return scope.Label;
    }
}

/// <summary>An audit scope tagged with the operation it covers.</summary>
internal sealed class AuditScope
{
    /// <summary>The operation label carried by this scope.</summary>
    public string Label { get; }

    /// <summary>Creates an audit scope for the named operation.</summary>
    public AuditScope(string operationName)
    {
        Label = operationName;
    }
}
