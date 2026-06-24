namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A concatenation chain made entirely of string literals — a deliberate
/// line-wrapping choice — so the useless-concat rule must not fire.
/// </summary>
public class UselessConcatSafe
{
    /// <summary>Returns the multi-line help banner.</summary>
    internal string Banner()
    {
        // SAFE: code-quality/deterministic/useless-concat
        return "Usage: report --from <date> --to <date>\n" +
            "Generates a billing summary for the given window.\n" +
            "Dates use the ISO calendar-day format.";
    }
}
