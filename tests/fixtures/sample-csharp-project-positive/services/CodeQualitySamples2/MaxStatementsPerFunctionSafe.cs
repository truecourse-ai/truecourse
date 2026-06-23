using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Builds a fixed label list using exactly the allowed number of statements.</summary>
public sealed class MaxStatementsPerFunctionSafe
{
    /// <summary>Returns thirty sequential labels assembled one statement at a time.</summary>
    internal List<string> BuildLabels()
    {
        // SAFE: code-quality/deterministic/max-statements-per-function
        var labels = new List<string>();
        labels.Add("a01");
        labels.Add("a02");
        labels.Add("a03");
        labels.Add("a04");
        labels.Add("a05");
        labels.Add("a06");
        labels.Add("a07");
        labels.Add("a08");
        labels.Add("a09");
        labels.Add("a10");
        labels.Add("a11");
        labels.Add("a12");
        labels.Add("a13");
        labels.Add("a14");
        labels.Add("a15");
        labels.Add("a16");
        labels.Add("a17");
        labels.Add("a18");
        labels.Add("a19");
        labels.Add("a20");
        labels.Add("a21");
        labels.Add("a22");
        labels.Add("a23");
        labels.Add("a24");
        labels.Add("a25");
        labels.Add("a26");
        labels.Add("a27");
        labels.Add("a28");
        return labels;
    }
}
