using System.Diagnostics;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Gates trace output through the <see cref="TraceSwitch"/>'s purpose-built
/// boolean <c>TraceVerbose</c> property rather than comparing its
/// <c>Level</c> by hand, which is the correct form the rule does not flag.
/// </summary>
public class TraceswitchWritelineifMisuseSafe
{
    private static readonly TraceSwitch ReportTrace = new("report", "Report tracing");

    /// <summary>Emits a verbose trace message when the switch allows it.</summary>
    public void TraceSummary(string summary)
    {
        // SAFE: code-quality/deterministic/traceswitch-writelineif-misuse
        Trace.WriteLineIf(ReportTrace.TraceVerbose, summary);
    }
}
