namespace Positive.Boundary.Bugs;

/// <summary>Writes a journal entry and always records that the attempt completed.</summary>
public sealed class UselessFinallySafe
{
    private bool _attempted;

    /// <summary>Whether a write attempt has completed.</summary>
    internal bool Attempted => _attempted;

    /// <summary>Runs the write and marks the attempt as finished in a finally block.</summary>
    internal void WriteEntry(string entry)
    {
        try
        {
            _attempted = entry.Length > 0;
        }
        // SAFE: bugs/deterministic/useless-finally
        finally
        {
            _attempted = true;
        }
    }
}
