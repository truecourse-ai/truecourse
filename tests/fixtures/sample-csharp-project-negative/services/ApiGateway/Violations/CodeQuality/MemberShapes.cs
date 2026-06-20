namespace ApiGatewayApp.Violations.CodeQuality;

internal sealed class MemberShapes
{
    // VIOLATION: code-quality/deterministic/prefer-tuple-syntax
    internal ValueTuple<int, string> Describe()
    {
        return default;
    }

    internal void Wire(Action<int> register)
    {
        // VIOLATION: code-quality/deterministic/prefer-lambda-over-delegate
        register(delegate(int code) { Track(code); });
    }

    private void Track(int code)
    {
        _last = code;
    }

    private int _last;

    internal int Last => _last;
}

internal sealed class EventRaiser
{
    internal event EventHandler Flushed;

    internal void Flush()
    {
        // VIOLATION: code-quality/deterministic/use-eventargs-empty
        Flushed?.Invoke(this, new EventArgs());
    }
}
