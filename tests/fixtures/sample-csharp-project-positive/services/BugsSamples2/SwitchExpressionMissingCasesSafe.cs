namespace Positive.Boundary.Bugs;

internal enum LinkIcon
{
    Idle,
    Connecting,
    Open,
}

/// <summary>A switch expression that handles every enum member, so no discard arm is needed.</summary>
public sealed class SwitchExpressionMissingCasesSafe
{
    /// <summary>Returns an icon for each link state, covering all declared members.</summary>
    internal string Icon(LinkIcon state) =>
        // SAFE: bugs/deterministic/switch-expression-missing-cases
        state switch
        {
            LinkIcon.Idle => "idle",
            LinkIcon.Connecting => "connecting",
            LinkIcon.Open => "open",
        };
}
