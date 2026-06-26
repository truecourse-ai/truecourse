namespace UserService.Violations.CodeQuality;

/// <summary>
/// Razor Pages code-behind whose type follows neither the page name nor the
/// <c>X.cshtml.cs</c> -&gt; <c>XModel</c> convention, so the file is genuinely
/// misnamed and hard to locate.
/// </summary>
// VIOLATION: code-quality/deterministic/csharp-filename-type-mismatch
public class UnrelatedReportState
{
    /// <summary>Number of rows processed.</summary>
    public int Count { get; private set; }

    /// <summary>Records that another row was processed.</summary>
    public void Bump()
    {
        Count++;
    }
}
