namespace ApiGateway.Violations.Bugs;

internal sealed class DiagnosticsHarness
{
    private bool _enabled;

    internal void CheckBalance(decimal balance)
    {
        // VIOLATION: bugs/deterministic/assert-without-message
        Debug.Assert(balance >= 0);
        _enabled = true;
    }

    internal void RouteFallback(int code)
    {
        if (code > 0)
        {
            return;
        }
        // VIOLATION: bugs/deterministic/debug-fail-without-message
        Debug.Fail();
    }

    internal bool Negate(bool raw)
    {
        // VIOLATION: code-quality/deterministic/double-negation
        return !!raw;
    }

    internal int Normalize(int mask)
    {
        // VIOLATION: bugs/deterministic/doubled-prefix-operator
        return ~~mask;
    }

    internal void Toggle(bool desired)
    {
        // VIOLATION: bugs/deterministic/check-against-value-being-assigned
        if (_enabled != desired)
        {
            _enabled = desired;
        }
    }
}
