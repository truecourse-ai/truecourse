using System.IO;

namespace UserServiceApp.Violations.Bugs;

internal sealed class SwallowedFlushErrors
{
    private int _writes;
    private int _cursor;

    internal void Flush()
    {
        try
        {
            Write();
            Advance();
        }
        // Not a single best-effort cleanup call — this genuinely swallows the error.
        // VIOLATION: bugs/deterministic/empty-catch
        catch (IOException)
        {
        }
    }

    private void Write() => _writes++;

    private void Advance() => _cursor++;
}
