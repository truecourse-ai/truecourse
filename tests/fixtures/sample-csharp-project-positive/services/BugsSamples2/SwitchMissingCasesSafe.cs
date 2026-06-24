namespace Positive.Boundary.Bugs;

internal enum ChannelMode
{
    Read,
    Write,
    Duplex,
}

/// <summary>A switch statement over an enum with an explicit default, so nothing is unhandled.</summary>
public sealed class SwitchMissingCasesSafe
{
    /// <summary>Describes a channel mode, with a default covering any remaining value.</summary>
    internal string Describe(ChannelMode mode)
    {
        // SAFE: bugs/deterministic/switch-missing-cases
        switch (mode)
        {
            case ChannelMode.Read:
                return "read";
            case ChannelMode.Write:
                return "write";
            default:
                return "duplex";
        }
    }
}
