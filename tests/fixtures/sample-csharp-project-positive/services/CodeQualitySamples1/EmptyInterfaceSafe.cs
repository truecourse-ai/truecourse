namespace Positive.Boundary.CodeQuality;

/// <summary>Marker contract used to compose two existing interfaces.</summary>
internal interface IReadable
{
    /// <summary>Reads the current value.</summary>
    int Read();
}

/// <summary>Marker contract used to compose two existing interfaces.</summary>
internal interface IWritable
{
    /// <summary>Writes the supplied value.</summary>
    void Write(int value);
}

/// <summary>
/// An interface with no members of its own is excluded when it composes other
/// interfaces via a base list, since that is a legitimate union rather than an
/// empty marker. The empty-interface rule must not fire.
/// </summary>
// SAFE: code-quality/deterministic/empty-interface
internal interface IEmptyInterfaceSafe : IReadable, IWritable
{
}

/// <summary>A concrete reader/writer that fulfils the composed contract.</summary>
public sealed class EmptyInterfaceSafe : IEmptyInterfaceSafe
{
    private int _value;

    /// <summary>Reads the current value.</summary>
    public int Read() => _value;

    /// <summary>Writes the supplied value.</summary>
    public void Write(int value) => _value = value;
}
