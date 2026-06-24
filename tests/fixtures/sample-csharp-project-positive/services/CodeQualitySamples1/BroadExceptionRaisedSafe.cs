using System;

namespace Positive.Boundary.CodeQuality;

/// <summary>Throws a specific exception type rather than the base Exception.</summary>
public sealed class BroadExceptionRaisedSafe
{
    private bool _open;

    /// <summary>Reads the channel, signaling an invalid state with a specific type.</summary>
    internal string Read(string channel)
    {
        if (!_open)
        {
            // SAFE: code-quality/deterministic/broad-exception-raised
            throw new InvalidOperationException("channel is closed");
        }
        return channel;
    }
}
