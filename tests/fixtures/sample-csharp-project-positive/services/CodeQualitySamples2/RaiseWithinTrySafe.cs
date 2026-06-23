namespace Positive.Boundary.CodeQuality;

/// <summary>
/// A deliberate throw inside a try whose catch logs and rethrows: the throw
/// still escapes the method, so it is not a disguised goto. The rule excludes
/// rethrow patterns, so raise-within-try must not fire.
/// </summary>
public class RaiseWithinTrySafe
{
    private readonly System.Collections.Generic.List<string> _log = new();

    /// <summary>Validates the row count and surfaces any failure to the caller.</summary>
    public void Import(System.Collections.Generic.List<string> rows)
    {
        try
        {
            if (rows.Count == 0)
            {
                // SAFE: code-quality/deterministic/raise-within-try
                throw new System.InvalidOperationException("Ledger import received no rows");
            }
        }
        catch (System.InvalidOperationException ex)
        {
            _log.Add(ex.Message);
            throw;
        }
    }
}
