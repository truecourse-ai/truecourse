namespace Positive.Boundary.CodeQuality;

/// <summary>Applies two independent guards, each on its own line.</summary>
public sealed class MisleadingSameLineConditionalSafe
{
    /// <summary>Returns a status code derived from two independent flags.</summary>
    internal int Classify(bool warmed, bool ready)
    {
        var code = 0;
        // SAFE: code-quality/deterministic/misleading-same-line-conditional
        if (warmed) code += 1;
        if (ready) code += 2;
        return code;
    }
}
