namespace Positive.Boundary.CodeQuality;

/// <summary>
/// Razor Pages code-behind. The framework mandates the <c>X.cshtml.cs</c> file to
/// declare an <c>XModel</c> type, so the file name and the type differ only by the
/// conventional <c>Model</c> suffix and the compound <c>.cshtml.cs</c> extension —
/// the file is correctly named.
/// </summary>
// SAFE: code-quality/deterministic/csharp-filename-type-mismatch
public class WidgetPanelModel
{
    /// <summary>The label rendered by the page.</summary>
    public string Label { get; private set; } = "widget";

    /// <summary>Updates the rendered label.</summary>
    public void Rename(string label)
    {
        Label = label;
    }
}
