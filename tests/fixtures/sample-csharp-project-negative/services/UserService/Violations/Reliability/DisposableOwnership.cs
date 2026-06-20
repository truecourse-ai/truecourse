using System;
using System.IO;

namespace UserServiceApp.Violations.Reliability;

internal sealed class FileBackedCache
{
    // VIOLATION: reliability/deterministic/disposable-field-without-idisposable
    private readonly FileStream _backing;

    internal FileBackedCache(string path)
    {
        _backing = File.Create(path);
    }

    internal void Append(byte[] data) => _backing.Write(data);
}

internal sealed class DualLog : IDisposable
{
    private readonly StreamWriter _primary;
    private readonly StreamWriter _secondary;

    internal DualLog(string a, string b)
    {
        _primary = new StreamWriter(a);
        _secondary = new StreamWriter(b);
    }

    internal void Write(string line)
    {
        _primary.WriteLine(line);
        _secondary.WriteLine(line);
    }

    /// <summary>Releases the writers.</summary>
    // VIOLATION: reliability/deterministic/dispose-own-members
    public void Dispose()
    {
        _primary.Dispose();
    }
}
