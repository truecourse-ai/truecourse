using System;
using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>Handles two exception types with distinct recovery bodies on one try.</summary>
public sealed class MergeableCatchClausesSafe
{
    /// <summary>Runs the action and records a per-type recovery note.</summary>
    internal string Run(Action work)
    {
        var notes = new List<string>();
        try
        {
            work();
            notes.Add("ok");
        }
        // SAFE: code-quality/deterministic/mergeable-catch-clauses
        catch (TimeoutException)
        {
            notes.Add("timed-out");
        }
        catch (InvalidOperationException)
        {
            notes.Add("invalid-state");
        }
        return string.Join(",", notes);
    }
}
