using System.Diagnostics;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Routes a message through a <see cref="TraceSource"/>, which is explicitly out
/// of scope for the rule (it only flags the level-less <c>Trace.Write</c> /
/// <c>Trace.WriteLine</c> shape), so it must not fire.
/// </summary>
public class TraceWriteUsageSafe
{
    private readonly TraceSource _source = new("Positive");

    /// <summary>Emits an informational trace message.</summary>
    public void Report(string message)
    {
        // SAFE: code-quality/deterministic/trace-write-usage
        _source.TraceInformation(message);
    }
}
