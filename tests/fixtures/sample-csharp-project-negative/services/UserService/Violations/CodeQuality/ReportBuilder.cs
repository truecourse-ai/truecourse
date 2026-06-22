using System.Data;
using System.Diagnostics;

namespace UserServiceApp.Violations.CodeQuality;

/// <summary>
/// Builds tabular account reports. One part of this partial type omits its access
/// modifier, it builds a culture-sensitive DataTable without a Locale, and it gates
/// trace output by comparing a TraceSwitch level by hand.
/// </summary>
// VIOLATION: code-quality/deterministic/partial-element-missing-access-modifier
partial class ReportBuilder
{
    private static readonly TraceSwitch ReportTrace = new TraceSwitch("report", "Report tracing");

    /// <summary>Builds the per-account report table.</summary>
    public DataTable BuildAccountTable()
    {
        // VIOLATION: code-quality/deterministic/locale-not-set
        var table = new DataTable("accounts");
        table.Columns.Add("Email");
        return table;
    }

    /// <summary>Emits a verbose trace summary of the rendered rows.</summary>
    public void TraceSummary(int rowCount)
    {
        // VIOLATION: code-quality/deterministic/traceswitch-writelineif-misuse
        Trace.WriteLineIf(ReportTrace.Level == TraceLevel.Verbose, $"rows={rowCount}");
    }
}

internal sealed partial class ReportBuilderState
{
    public int RenderedRows { get; set; }
}
