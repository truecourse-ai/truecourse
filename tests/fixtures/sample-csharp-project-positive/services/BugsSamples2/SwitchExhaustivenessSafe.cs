namespace Positive.Boundary.Bugs;

internal enum LinkPhase
{
    Idle,
    Connecting,
    Open,
}

/// <summary>Maps every declared enum member, so the switch is exhaustive without a default.</summary>
public sealed class SwitchExhaustivenessSafe
{
    /// <summary>Returns a label for each connection phase, covering all members.</summary>
    internal string Describe(LinkPhase phase)
    {
        // SAFE: bugs/deterministic/switch-exhaustiveness
        switch (phase)
        {
            case LinkPhase.Idle:
                return "idle";
            case LinkPhase.Connecting:
                return "connecting";
            case LinkPhase.Open:
                return "open";
            default:
                return "unknown";
        }
    }
}
