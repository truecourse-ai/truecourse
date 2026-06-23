using System;
using System.Collections.Generic;
using System.IO;

namespace UserServiceApp.Violations.Reliability;

internal sealed class ImportJob
{
    private const int MaxFailureStreak = 5;

    private readonly string _dropFolder;
    private int _failureStreak;

    internal ImportJob(string dropFolder)
    {
        _dropFolder = dropFolder;
    }

    internal List<string> ReadBatch(string fileName)
    {
        var lines = new List<string>();
        try
        {
            // VIOLATION: reliability/deterministic/missing-finally-cleanup
            // VIOLATION: reliability/deterministic/idisposable-not-disposed
            var reader = new StreamReader(Path.Combine(_dropFolder, fileName));
            for (var line = reader.ReadLine(); line != null; line = reader.ReadLine())
            {
                lines.Add(line);
            }
        }
        catch (IOException ex)
        {
            // VIOLATION: reliability/deterministic/console-error-no-context
            Console.WriteLine(ex);
        }
        return lines;
    }

    internal int ProcessAll(IReadOnlyList<string> fileNames)
    {
        var imported = 0;
        foreach (var name in fileNames)
        {
            try
            {
                var batch = ReadBatch(name);
                imported += batch.Count;
                _failureStreak = 0;
            }
            // VIOLATION: reliability/deterministic/catch-without-error-type
            catch (Exception)
            {
                _failureStreak++;
                if (_failureStreak >= MaxFailureStreak)
                {
                    // VIOLATION: reliability/deterministic/process-exit-in-library
                    Environment.Exit(2);
                }
            }
        }
        return imported;
    }

    internal void Archive(string fileName)
    {
        try
        {
            File.Move(Path.Combine(_dropFolder, fileName), Path.Combine(_dropFolder, "archive", fileName));
        }
        // VIOLATION: reliability/deterministic/catch-rethrow-no-context
        // VIOLATION: code-quality/deterministic/no-useless-catch
        // VIOLATION: code-quality/deterministic/useless-catch
        catch (Exception ex)
        {
            throw ex;
        }
    }
}
