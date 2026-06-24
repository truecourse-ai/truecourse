namespace Positive.Boundary.CodeQuality;

/// <summary>Passes a boolean to a multi-argument call using a named argument.</summary>
public sealed class BooleanTrapSafe
{
    private readonly string _prefix = "channel";

    /// <summary>Configures the channel, naming the boolean to keep intent clear.</summary>
    internal string Setup(string channel)
    {
        // SAFE: code-quality/deterministic/boolean-trap
        return Configure(_prefix + channel, verbose: true);
    }

    private static string Configure(string channel, bool verbose)
    {
        return verbose ? channel + ":verbose" : channel;
    }
}
