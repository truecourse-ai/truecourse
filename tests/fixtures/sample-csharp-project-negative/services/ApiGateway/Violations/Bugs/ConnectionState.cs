namespace ApiGateway.Violations.Bugs;

internal enum LinkState
{
    Idle,
    Connecting,
    Open,
}

// Maps connection states to labels and transitions, but both the switch statement
// and the switch expression omit the Open case, so an Open link falls through
// unhandled.
internal sealed class ConnectionState
{
    internal string Describe(LinkState state)
    {
        // Missing the LinkState.Open case and no default — Open hits nothing.
        // VIOLATION: bugs/deterministic/switch-missing-cases
        // VIOLATION: bugs/deterministic/switch-exhaustiveness
        // VIOLATION: code-quality/deterministic/default-case-in-switch
        // VIOLATION: code-quality/deterministic/trivial-switch
        switch (state)
        {
            case LinkState.Idle:
                return "idle";
            case LinkState.Connecting:
                return "connecting";
        }

        return "unknown";
    }

    internal string Icon(LinkState state) =>
        // The switch expression omits Open and has no discard arm — non-exhaustive.
        // VIOLATION: bugs/deterministic/switch-expression-missing-cases
        // VIOLATION: bugs/deterministic/switch-exhaustiveness
        state switch
        {
            LinkState.Idle => "·",
            LinkState.Connecting => "…",
        };
}
