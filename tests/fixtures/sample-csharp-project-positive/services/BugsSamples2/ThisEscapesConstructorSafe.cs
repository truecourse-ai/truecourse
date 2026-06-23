namespace Positive.Boundary.Bugs;

/// <summary>Builds a connection and wires its internal buffer during construction.</summary>
public sealed class ThisEscapesConstructorSafe
{
    private int _bufferSize;

    /// <summary>Creates the connection with the given buffer size.</summary>
    public ThisEscapesConstructorSafe(int bufferSize)
    {
        _bufferSize = bufferSize;

        // SAFE: bugs/deterministic/this-escapes-constructor
        Configure(this);
    }

    /// <summary>Current buffer size.</summary>
    internal int BufferSize => _bufferSize;

    // Private instance helper on the same type: `this` never leaves the class,
    // so the escape rule deliberately suppresses this accepted init pattern.
    private void Configure(ThisEscapesConstructorSafe self)
    {
        _bufferSize = self._bufferSize + 1;
    }
}
