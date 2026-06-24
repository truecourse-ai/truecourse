using System;
using System.IO;

namespace Positive.Boundary.Reliability;

/// <summary>Writes a contextful failure line rather than the bare exception.</summary>
internal sealed class ConsoleErrorNoContextSafe
{
    private readonly string _dropFolder;

    internal ConsoleErrorNoContextSafe(string dropFolder)
    {
        _dropFolder = dropFolder;
    }

    internal bool TryArchive(string fileName)
    {
        try
        {
            File.Move(Path.Combine(_dropFolder, fileName), Path.Combine(_dropFolder, "archive", fileName));
            return true;
        }
        catch (IOException exception)
        {
            // SAFE: reliability/deterministic/console-error-no-context
            Console.Error.WriteLine($"Failed to archive {fileName}: {exception.Message}");
            return false;
        }
    }
}
