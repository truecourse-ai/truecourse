namespace ApiGateway.Violations.Bugs;

// Base retry strategy with a virtual hook that has an optional parameter.
// VIOLATION: code-quality/deterministic/too-many-classes-per-file
// VIOLATION: code-quality/deterministic/abstract-class-without-abstract-members
internal abstract class RetryStrategy
{
    // VIOLATION: code-quality/deterministic/non-private-field
    protected int LastDelayMs;

    internal virtual void Attempt(int attempts, int delayMs = 100)
    {
        LastDelayMs = delayMs * attempts;
    }
}

// An exponential-backoff strategy whose override mis-handles the inherited contract:
// it changes the optional parameter's default value, and it calls base.Attempt without
// forwarding the optional argument.
internal sealed class ExponentialBackoff : RetryStrategy
{
    // Changing the default from 100 to 250 means callers see a different default
    // depending on the static type they hold.
    // VIOLATION: bugs/deterministic/override-changes-default-parameter
    internal override void Attempt(int attempts, int delayMs = 250)
    {
        // base.Attempt() drops delayMs — the base runs with its own default, not the
        // caller's value.
        // VIOLATION: bugs/deterministic/optional-arg-not-forwarded-to-base
        base.Attempt(attempts);
    }
}

// A linear strategy whose override introduces `params` the base never declared, so the
// expanded call form only works through the derived static type.
internal abstract class BatchRetry
{
    internal abstract void Flush(int[] codes);
}

internal sealed class LinearBatchRetry : BatchRetry
{
    // VIOLATION: bugs/deterministic/params-introduced-on-override
    internal override void Flush(params int[] codes)
    {
    }
}

// A request builder with two overloads that overlap once the optional parameter on the
// longer one is filled in by the compiler — Build(1) is ambiguous.
internal sealed class RequestBuilder
{
    private int _lastId;

    internal void Build(int id)
    {
        _lastId = id;
    }

    // VIOLATION: bugs/deterministic/overlapping-default-overloads
    internal void Build(int id, int retries = 0)
    {
        _lastId = id + retries;
    }

    internal int LastId => _lastId;
}
