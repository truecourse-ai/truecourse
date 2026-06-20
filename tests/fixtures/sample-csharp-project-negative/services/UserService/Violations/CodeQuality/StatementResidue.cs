using System;
using System.Diagnostics;

namespace UserServiceApp.Violations.CodeQuality;

internal sealed class StatementResidue
{
    internal void Report(string message)
    {
        // VIOLATION: code-quality/deterministic/trace-write-usage
        Trace.WriteLine(message);
    }

    internal bool SameName(string a, string b)
    {
        // VIOLATION: code-quality/deterministic/string-compare-to-zero
        return String.Compare(a, b) == 0;
    }

    internal long ToLong(int small)
    {
        // VIOLATION: code-quality/deterministic/literal-suffix-over-cast
        return (long)1 + small;
    }
}
