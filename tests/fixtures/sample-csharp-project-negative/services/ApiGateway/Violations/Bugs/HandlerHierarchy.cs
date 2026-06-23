namespace ApiGateway.Violations.Bugs;

/// <summary>Base request handler with value-semantics Equals and a lifecycle hook.</summary>
// VIOLATION: code-quality/deterministic/too-many-classes-per-file
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
internal class RequestHandlerBase
{
    // VIOLATION: code-quality/deterministic/non-private-field
    protected int RetryBudget;

    public override bool Equals(object obj) => obj is RequestHandlerBase other && other.RetryBudget == RetryBudget;

    // VIOLATION: bugs/deterministic/gethashcode-uses-mutable-field
    public override int GetHashCode() => RetryBudget;

    /// <summary>Resets the retry budget before the handler runs.</summary>
    public void Start()
    {
        RetryBudget = 3;
    }
}

/// <summary>A handler that hides the base Start() without `new`.</summary>
internal class StreamingHandler : RequestHandlerBase
{
    // Differs from the inherited protected RetryBudget only by case — a likely typo
    // that shadows nothing and confuses readers, and is itself never read.
    // VIOLATION: bugs/deterministic/child-field-differs-only-by-case
    // VIOLATION: code-quality/deterministic/unread-private-attribute
    private int retrybudget;

    /// <summary>Begins streaming. Unintentionally hides RequestHandlerBase.Start.</summary>
    // VIOLATION: bugs/deterministic/base-method-hidden
    public void Start()
    {
        retrybudget = 5;
    }

    /// <summary>Compares two handlers by reference — except it does not.</summary>
    public bool SameAs(object other)
    {
        // base.Equals resolves to the value-semantics override on RequestHandlerBase,
        // not a reference-identity test.
        // VIOLATION: bugs/deterministic/base-equals-not-reference-equality
        // VIOLATION: bugs/deterministic/redundant-base-call
        return base.Equals(other);
    }
}

/// <summary>Narrows the inherited public Start() down to protected via `new`.</summary>
internal class GuardedHandler : RequestHandlerBase
{
    // VIOLATION: bugs/deterministic/inherited-member-visibility-decreased
    protected new void Start()
    {
        RetryBudget = 0;
    }
}

internal interface IDispatchSink
{
    void Dispatch();
}

/// <summary>Implements Dispatch explicitly on an unsealed class without re-exposing it.</summary>
internal class TelemetrySink : IDispatchSink
{
    private int _count;

    // VIOLATION: bugs/deterministic/interface-method-not-callable-by-derived
    // VIOLATION: code-quality/deterministic/missing-access-modifier
    void IDispatchSink.Dispatch()
    {
        _count++;
    }
}
