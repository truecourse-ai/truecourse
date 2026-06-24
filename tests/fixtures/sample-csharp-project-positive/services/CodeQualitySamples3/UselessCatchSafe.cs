using System;
using System.Collections.Generic;

namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A catch clause that wraps the original exception with extra context before
/// throwing, so it is doing real work and the useless-catch rule must not fire.
/// </summary>
public class UselessCatchSafe
{
    /// <summary>Looks up <paramref name="key"/>, adding context on failure.</summary>
    internal string Lookup(IReadOnlyDictionary<string, string> table, string key)
    {
        try
        {
            return table[key];
        }
        // SAFE: code-quality/deterministic/useless-catch
        catch (KeyNotFoundException ex)
        {
            throw new InvalidOperationException($"No entry for '{key}'", ex);
        }
    }
}
